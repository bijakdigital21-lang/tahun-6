'use strict';
const get = id => document.getElementById(id);
const books = KiddyReadsCatalog;
const bookLoads = new Map();

const storageKey = 'kiddyreads.finished.v1';
const bookIds = new Set(books.map(book => book.id));
const grid = get('grid');
const reader = get('reader');
const readerBody = get('reader-body');
const storyPage = get('story-page');
const storyText = get('story-text');
const readAloud = get('read-aloud');
const narrationNote = get('narration-note');
const canSpeak = typeof window.Audio === 'function';
const readerCheck = get('reader-check');
const search = get('search');
const filters = [...document.querySelectorAll('[data-filter]')];
const progress = get('progress');
const cards = new Map();
let filter = 'all';
let finished = new Set();
let activeBook = null;
let readerSession = 0;
let page = 0;
let opener = null;
let audioContext;
let pageTurn;
let storyWords = [];
let activeAudio = null;
let highlightFrame = 0;
let highlightedWord = null;

if (!canSpeak) {
  readAloud.disabled = true;
  narrationNote.textContent = 'Read Aloud is unavailable in this browser.';
}

function clearNarrationError() {
  if (!canSpeak) return;
  narrationNote.textContent = 'Tap any word to hear it.';
  delete narrationNote.dataset.error;
}

function highlightWord(button) {
  highlightedWord?.removeAttribute('aria-current');
  highlightedWord = button;
  button?.setAttribute('aria-current', 'true');
}

function setReading(reading) {
  readAloud.setAttribute('aria-pressed', String(reading));
  get('read-aloud-text').textContent = reading ? 'Stop Reading' : 'Read Aloud';
}

const player = canSpeak ? new window.Audio() : null;
if (player) { player.preload = 'auto'; player.setAttribute('playsinline', ''); }
let playToken = 0;
let autoplayBlocked = false;

function stopSpeech() {
  cancelAnimationFrame(highlightFrame);
  playToken++;
  if (activeAudio) {
    activeAudio = null;
    player.onplaying = player.onended = player.onerror = null;
    player.pause();
  }
  highlightWord(null);
  setReading(false);
}

function speakStory(word = null) {
  if (!canSpeak || !activeBook) return;
  stopSpeech();
  clearNarrationError();
  autoplayBlocked = false;
  const media = pageMedia(activeBook, page);
  const asset = word ? KiddyReadsWords[word.key] : media[1];
  const timings = media[2];
  const token = playToken;
  const isCurrent = () => token === playToken;

  function reportError() {
    stopSpeech();
    narrationNote.dataset.error = '';
    narrationNote.textContent = 'Audio could not play. Tap to try again.';
  }
  if (!asset) {
    reportError();
    return;
  }

  const audio = player;
  audio.src = 'data:audio/mpeg;base64,' + asset;
  activeAudio = audio;
  setReading(!word);
  let currentIndex = -1;

  function syncHighlight() {
    if (!isCurrent() || audio.paused) return;
    const milliseconds = audio.currentTime * 1000;
    let index = currentIndex;
    while (index + 1 < timings.length && timings[index + 1] <= milliseconds) index++;
    if (index !== currentIndex) {
      currentIndex = index;
      highlightWord(storyWords[index]?.button);
    }
    highlightFrame = requestAnimationFrame(syncHighlight);
  }

  audio.onplaying = () => {
    if (!isCurrent()) return;
    if (word) highlightWord(word.button);
    else {
      cancelAnimationFrame(highlightFrame);
      syncHighlight();
    }
  };
  audio.onended = () => { if (isCurrent()) stopSpeech(); };
  audio.onerror = () => { if (isCurrent()) reportError(); };
  const attempt = audio.play();
  if (attempt && attempt.catch) attempt.catch(error => {
    if (!isCurrent()) return;
    if (error && error.name === 'NotAllowedError') {
      // The browser blocked automatic sound: start on the next tap anywhere.
      stopSpeech();
      autoplayBlocked = true;
      narrationNote.textContent = 'Tap anywhere to hear the story.';
    } else reportError();
  });
}

reader.addEventListener('pointerdown', event => {
  if (!autoplayBlocked || event.target.closest('button, label, input')) return;
  speakStory();
});

readAloud.addEventListener('click', () => {
  if (readAloud.getAttribute('aria-pressed') === 'true') stopSpeech();
  else speakStory();
});

function renderStoryWords(parts) {
  const text = parts.map(([part]) => part).join('');
  const words = [...text.matchAll(/[a-z0-9]+(?:[’'-][a-z0-9]+)*/gi)];
  const emphasis = [];
  let end = 0;
  for (const [part, bold] of parts) {
    if (bold) emphasis.push([end, end + part.length]);
    end += part.length;
  }

  storyText.replaceChildren();
  let cursor = 0;
  storyWords = words.map(match => {
    const word = match[0];
    const start = match.index;
    const end = start + word.length;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'story-word';
    button.textContent = word;
    button.disabled = !canSpeak;
    if (emphasis.some(([first, last]) => first < end && last > start)) button.dataset.emphasis = '';
    const entry = {key: word.toLowerCase().replace(/’/g, "'"), button};
    button.addEventListener('click', () => speakStory(entry));
    storyText.append(text.slice(cursor, start), button);
    cursor = end;
    return entry;
  });
  storyText.append(text.slice(cursor));
}

function playClick() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  try {
    audioContext ??= new AudioContextClass();
    if (audioContext.state !== 'running') audioContext.resume().catch(() => {});
    const tone = audioContext.createOscillator();
    const volume = audioContext.createGain();
    const start = audioContext.currentTime;
    tone.type = 'sine';
    tone.frequency.setValueAtTime(720, start);
    tone.frequency.exponentialRampToValueAtTime(360, start + 0.045);
    volume.gain.setValueAtTime(0.001, start);
    volume.gain.exponentialRampToValueAtTime(0.105, start + 0.005);
    volume.gain.exponentialRampToValueAtTime(0.001, start + 0.07);
    tone.connect(volume);
    volume.connect(audioContext.destination);
    tone.start(start);
    tone.stop(start + 0.075);
  } catch {
    // Reading controls stay usable when audio is unavailable.
  }
}

document.addEventListener('click', event => {
  if (event.target.closest?.('button:not(:disabled):not(.story-word), a[href], input[type="checkbox"], input[type="search"]')) {
    playClick();
  }
}, true);

function storageUnavailable() {
  get('storage-note').textContent = 'KiddyReads · Reading progress is available for this visit only.';
}

function parseFinished(value) {
  try {
    const ids = JSON.parse(value || '[]');
    return new Set(Array.isArray(ids) ? ids.filter(id => bookIds.has(id)) : []);
  } catch {
    return new Set();
  }
}

try {
  finished = parseFinished(localStorage.getItem(storageKey));
} catch {
  storageUnavailable();
}

function pageMedia(book, index) {
  return index === 0 ? book.firstPage : KiddyReadsBookMedia[book.id][index - 1];
}

function imageSource(book, index) {
  return 'data:image/webp;base64,' + pageMedia(book, index)[0];
}

function loadBookMedia(book) {
  if (KiddyReadsBookMedia[book.id]) return Promise.resolve();
  if (!bookLoads.has(book.id)) {
    const request = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'scripts/book-' + bookNumber(book) + '.js';
      script.onload = () => {
        script.remove();
        if (KiddyReadsBookMedia[book.id]) resolve();
        else reject(new Error('Book media is missing.'));
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('Book media could not load.'));
      };
      document.head.append(script);
    }).finally(() => bookLoads.delete(book.id));
    bookLoads.set(book.id, request);
  }
  return bookLoads.get(book.id);
}

function bookNumber(book) {
  return String(book.id).padStart(2, '0');
}

function searchable(value) {
  return value.toLowerCase().normalize('NFKD').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function updateCard(book) {
  const { card, check, status } = cards.get(book.id);
  const done = finished.has(book.id);
  check.checked = done;
  status.textContent = done ? 'Finished' : 'Mark as finished';
  check.setAttribute('aria-label', (done ? 'Finished reading ' : 'Mark as finished: ') + book.title);
  card.dataset.done = done;
}

function updateProgress() {
  get('progress-text').textContent = finished.size + ' of ' + books.length + ' finished';
  progress.setAttribute('aria-valuemax', books.length);
  progress.setAttribute('aria-valuenow', finished.size);
  progress.firstElementChild.style.width = (100 * finished.size / books.length) + '%';
}

function updateShelf() {
  const query = searchable(search.value);
  let count = 0;
  for (const book of books) {
    const { card, searchTitle } = cards.get(book.id);
    const done = finished.has(book.id);
    const matchesFilter = filter === 'all' || (filter === 'finished' ? done : !done);
    card.hidden = !(matchesFilter && searchTitle.includes(query));
    if (!card.hidden) count++;
  }
  get('result').textContent = count + (count === 1 ? ' story' : ' stories');
  const empty = get('empty');
  empty.hidden = count > 0;
  if (!count) {
    empty.textContent = query ? 'No stories match your search.' :
      filter === 'finished' ? 'Your finished books will appear here.' : 'You’ve finished every story!';
  }
}

function updateReaderCheck() {
  const done = finished.has(activeBook.id);
  readerCheck.checked = done;
  get('reader-check-label').textContent = done ? 'Finished' : 'Mark as finished';
  const note = get('finish-note');
  const isLast = page === activeBook.pages.length - 1;
  readerCheck.closest('label').hidden = !isLast;
  note.hidden = !isLast;
  note.textContent = done ? 'The end! Great reading!' : 'The end! Tick the box when you’ve finished reading.';
}

function setFinished(book, done) {
  const { card, check } = cards.get(book.id);
  const hadFocus = document.activeElement === check;
  if (done) finished.add(book.id);
  else finished.delete(book.id);
  try {
    localStorage.setItem(storageKey, JSON.stringify([...finished]));
  } catch {
    storageUnavailable();
  }
  updateCard(book);
  updateProgress();
  updateShelf();
  if (activeBook?.id === book.id) updateReaderCheck();
  if (card.hidden && hadFocus) {
    filters.find(button => button.dataset.filter === filter).focus();
  }
}

for (const book of books) {
  const card = get('card-template').content.firstElementChild.cloneNode(true);
  const cover = card.querySelector('.cover');
  const check = card.querySelector('input');
  cover.firstElementChild.src = imageSource(book, 0);
  cover.setAttribute('aria-label', 'Read ' + book.title);
  card.querySelector('.book-number').textContent = bookNumber(book);
  card.querySelector('h3').textContent = book.title;
  cards.set(book.id, {card, check, status: card.querySelector('.check span'), searchTitle: searchable(book.title)});
  cover.addEventListener('click', () => openBook(book, cover));
  check.addEventListener('change', () => setFinished(book, check.checked));
  updateCard(book);
  grid.append(card);
}

function renderPage() {
  const parts = activeBook.pages[page];
  const lastPage = page === activeBook.pages.length - 1;
  get('story-image').src = imageSource(activeBook, page);
  clearNarrationError();
  renderStoryWords(parts);
  get('prev').disabled = page === 0;
  get('next-text').textContent = lastPage ? 'Back to shelf' : 'Next';
  get('page-status').textContent = 'Page ' + (page + 1) + ' of ' + activeBook.pages.length;
  updateReaderCheck();
  readerBody.scrollTop = 0;
}

function openBook(book, button) {
  readerSession++;
  opener = button;
  activeBook = book;
  page = 0;
  get('reader-number').textContent = 'Book ' + bookNumber(book);
  get('reader-title').textContent = book.title;
  renderPage();
  reader.showModal();
  document.body.classList.add('reading');
  speakStory();
  loadBookMedia(book).catch(() => {});
}

async function turnPage(step, withSound = false) {
  const target = page + step;
  if (!activeBook || target < 0 || target >= activeBook.pages.length) return;
  if (withSound) playClick();

  if (target > 0 && !KiddyReadsBookMedia[activeBook.id]) {
    const book = activeBook;
    const currentPage = page;
    const currentReader = readerSession;
    try {
      await loadBookMedia(book);
    } catch {
      if (reader.open && readerSession === currentReader && page === currentPage) {
        narrationNote.dataset.error = '';
        narrationNote.textContent = 'This page could not load. Tap Next to try again.';
      }
      return;
    }
    if (!reader.open || readerSession !== currentReader || page !== currentPage) return;
  }
  stopSpeech();

  pageTurn?.cancel();
  if (storyPage.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const sheet = storyPage.cloneNode(true);
    sheet.removeAttribute('id');
    for (const child of sheet.querySelectorAll('[id]')) child.removeAttribute('id');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.inert = true;
    sheet.classList.add('turning-page');
    sheet.style.transformOrigin = step > 0 ? 'left center' : 'right center';
    storyPage.after(sheet);

    const animation = sheet.animate([
      {transform: 'rotateY(0deg)', opacity: 1},
      {transform: 'rotateY(0deg)', opacity: 1, offset: 0.08},
      {transform: `rotateY(${step * -96}deg)`, opacity: 0.9}
    ], {duration: 360, easing: 'cubic-bezier(.34,.08,.42,1)'});
    pageTurn = animation;
    const cleanUp = () => {
      sheet.remove();
      if (pageTurn === animation) pageTurn = null;
    };
    animation.finished.then(cleanUp, cleanUp);
  }

  page = target;
  renderPage();
  speakStory();
}

get('prev').addEventListener('click', () => turnPage(-1));
get('next').addEventListener('click', () => {
  if (page === activeBook.pages.length - 1) reader.close();
  else turnPage(1);
});
get('close-reader').addEventListener('click', () => reader.close());
reader.addEventListener('close', () => {
  readerSession++;
  stopSpeech();
  pageTurn?.cancel();
  document.body.classList.remove('reading');
  activeBook = null;
  get('story-image').removeAttribute('src');
  if (opener && !opener.closest('.card').hidden) opener.focus({preventScroll:true});
  else filters.find(button => button.dataset.filter === filter).focus();
});
readerCheck.addEventListener('change', () => setFinished(activeBook, readerCheck.checked));
reader.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    turnPage(event.key === 'ArrowLeft' ? -1 : 1, true);
  }
});

let swipeStart = null;
readerBody.addEventListener('touchstart', event => {
  if (event.touches.length !== 1 || event.target.closest('label')) {
    swipeStart = null;
    return;
  }
  const {clientX, clientY} = event.touches[0];
  swipeStart = {x: clientX, y: clientY};
}, {passive:true});
readerBody.addEventListener('touchcancel', () => { swipeStart = null; });
readerBody.addEventListener('touchend', event => {
  if (!swipeStart) return;
  const dx = event.changedTouches[0].clientX - swipeStart.x;
  const dy = event.changedTouches[0].clientY - swipeStart.y;
  swipeStart = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 1.6 * Math.abs(dy)) turnPage(dx < 0 ? 1 : -1, true);
}, {passive:true});

for (const button of filters) {
  button.addEventListener('click', () => {
    filter = button.dataset.filter;
    for (const other of filters) other.setAttribute('aria-pressed', other === button);
    updateShelf();
  });
}
search.addEventListener('input', updateShelf);
window.addEventListener('storage', event => {
  if (event.key !== storageKey && event.key !== null) return;
  finished = parseFinished(event.newValue);
  for (const book of books) updateCard(book);
  updateProgress();
  updateShelf();
  if (activeBook) updateReaderCheck();
});

updateProgress();
updateShelf();
