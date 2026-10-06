const questionInput = document.getElementById('question');
const attemptInput = document.getElementById('attempt');
const newAttemptInput = document.getElementById('new-attempt');
const submitButton = document.getElementById('submit-button');
const recheckButton = document.getElementById('recheck-button');
const strongerHintButton = document.getElementById('stronger-hint-button');
const emptyState = document.getElementById('empty-state');
const resultCard = document.getElementById('result-card');
const resultContent = document.getElementById('result-content');
const retryPanel = document.getElementById('retry-panel');
const hintIndicator = document.getElementById('hint-indicator');
const levelProgress = document.getElementById('level-progress');
const statusBanner = document.getElementById('status-banner');
const imageUpload = document.getElementById('image-upload');
const imageEmpty = document.getElementById('image-empty');
const imagePreview = document.getElementById('image-preview');
const imagePreviewWrapper = document.getElementById('image-preview-wrapper');
const imageFilename = document.getElementById('image-filename');
const removeImageButton = document.getElementById('remove-image');

let currentHintLevel = 1;
let lastQuestion = '';
let originalAttempt = '';
let lastAttempt = '';
let isLoading = false;
let selectedImageDataUrl = '';
let selectedImageName = '';
let sessionId = localStorage.getItem('socratic-session-id') || `session-${Date.now()}`;
localStorage.setItem('socratic-session-id', sessionId);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showStatus(message, state = '') {
  statusBanner.textContent = message;
  statusBanner.classList.remove('hidden', 'loading', 'error', 'success');
  if (state) statusBanner.classList.add(state);
}

function setLoading(loading, label = 'Thinking about your work…') {
  isLoading = loading;
  submitButton.disabled = loading;
  recheckButton.disabled = loading;
  strongerHintButton.disabled = loading;

  submitButton.querySelector('.button-text').textContent = loading ? 'Thinking…' : 'Help Me Think';
  recheckButton.querySelector('.button-text').textContent = loading ? 'Checking…' : 'Check My Thinking';
  strongerHintButton.querySelector('.button-text').textContent = loading ? 'Thinking…' : 'I’m stuck — give me a clearer hint';

  if (loading) showStatus(label, 'loading');
}

function renderResult(data) {
  emptyState.classList.add('hidden');
  resultCard.classList.remove('hidden');

  const level = Math.max(1, Math.min(currentHintLevel, 3));
  const levelNames = ['gentle question', 'clearer hint', 'stronger guidance'];
  hintIndicator.textContent = data.correct ? 'Reasoning reached' : `Level ${level} · ${levelNames[level - 1]}`;
  levelProgress.style.width = `${level * 33.333}%`;

  if (data.correct) {
    resultContent.innerHTML = `
      <div class="success-box">
        <h3>✅ You got it!</h3>
        <p><strong>What you did well:</strong> ${escapeHtml(data.whatChanged || data.whatINoticed || 'You worked through the reasoning and reached a consistent result.')}</p>
        <p><strong>Why it works:</strong> ${escapeHtml(data.whyItWorks || data.concept || 'Your steps now support the conclusion you reached.')}</p>
        ${data.finalAnswer ? `<p><strong>Result:</strong> ${escapeHtml(data.finalAnswer)}</p>` : ''}
        ${data.concept ? `<p><strong>Concept learned:</strong> ${escapeHtml(data.concept)}</p>` : ''}
      </div>
    `;
    retryPanel.classList.add('hidden');
    strongerHintButton.classList.add('hidden');
    showStatus('Your reasoning is on the right track.', 'success');
    return;
  }

  const mistakeLabel = data.mistakeType && !['None', 'Correct reasoning'].includes(data.mistakeType)
    ? `<span class="mistake-label">Possible focus: ${escapeHtml(data.mistakeType)}</span>`
    : '';
  const hintText = [data.hint, data.nextStep && data.nextStep !== data.hint ? data.nextStep : '']
    .filter(Boolean)
    .map(escapeHtml)
    .join('<br /><br />');

  resultContent.innerHTML = `
    <article class="result-block">
      <h3><span aria-hidden="true">🔎</span> What I Noticed</h3>
      <p>${escapeHtml(data.whatINoticed || 'There may be a step worth checking more closely.')}</p>
      ${mistakeLabel}
    </article>
    <article class="result-block">
      <h3><span aria-hidden="true">❓</span> Socratic Question</h3>
      <p>${escapeHtml(data.socraticQuestion || 'What do you notice when you test your idea on a small example?')}</p>
    </article>
    <article class="result-block">
      <h3><span aria-hidden="true">💡</span> Hint</h3>
      <p>${hintText || 'Try one small step and see what changes.'}</p>
    </article>
  `;

  retryPanel.classList.remove('hidden');
  strongerHintButton.classList.toggle('hidden', level >= 3);
  showStatus(level >= 3 ? 'Try updating your work with this guidance.' : 'Take your time. Ask for more help if you get stuck.');
}

function showError(message = 'Something went wrong while thinking. Please try again.') {
  emptyState.classList.add('hidden');
  resultCard.classList.remove('hidden');
  retryPanel.classList.add('hidden');
  strongerHintButton.classList.add('hidden');
  hintIndicator.textContent = 'Try again';
  resultContent.innerHTML = `
    <article class="result-block">
      <h3>We couldn’t check that just now</h3>
      <p>${escapeHtml(message)}</p>
    </article>
  `;
  showStatus(message, 'error');
}

async function requestTutor(endpoint, payload) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        attempt: payload.attempt || '',
        previousAttempt: payload.previousAttempt || '',
        newAttempt: payload.newAttempt || '',
        hintLevel: Number(payload.hintLevel) || currentHintLevel,
        sessionId,
        imageDataUrl: selectedImageDataUrl || undefined,
        imageName: selectedImageName || undefined
      })
    });
  } catch {
    throw new Error('Could not connect to Socratic. Check that the server is running, then try again.');
  }
  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.success) {
    throw new Error(result.message || 'Something went wrong while thinking. Please try again.');
  }

  return result.data;
}

async function handleSubmit() {
  if (isLoading) return;
  const question = questionInput.value.trim();
  const attempt = attemptInput.value.trim();

  if (!question) {
    showStatus('Add the problem or question you want to think through.', 'error');
    questionInput.focus();
    return;
  }
  if (!attempt && !selectedImageDataUrl) {
    showStatus('Share some work, an approach, code, or a handwritten image first.', 'error');
    attemptInput.focus();
    return;
  }

  currentHintLevel = 1;
  lastQuestion = question;
  originalAttempt = attempt;
  lastAttempt = attempt;
  setLoading(true);

  try {
    const data = await requestTutor('/api/hint', {
      question,
      attempt,
      previousAttempt: '',
      newAttempt: '',
      hintLevel: currentHintLevel
    });
    renderResult(data);
  } catch (error) {
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

async function handleStrongerHint() {
  if (isLoading || !lastQuestion) return;

  const previousLevel = currentHintLevel;
  currentHintLevel = Math.min(currentHintLevel + 1, 3);
  setLoading(true, 'Finding a clearer way to guide you…');

  try {
    const data = await requestTutor('/api/hint', {
      question: lastQuestion,
      attempt: originalAttempt,
      previousAttempt: lastAttempt,
      newAttempt: '',
      hintLevel: currentHintLevel
    });
    renderResult(data);
  } catch (error) {
    currentHintLevel = previousLevel;
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

async function handleRecheck() {
  if (isLoading) return;
  const newAttempt = newAttemptInput.value.trim();

  if (!newAttempt && !selectedImageDataUrl) {
    showStatus('Add the new step or explanation you want me to check.', 'error');
    newAttemptInput.focus();
    return;
  }

  const previousLevel = currentHintLevel;
  currentHintLevel = Math.min(currentHintLevel + 1, 3);
  setLoading(true, 'Checking your thinking…');

  try {
    const data = await requestTutor('/api/recheck', {
      question: lastQuestion,
      attempt: originalAttempt,
      previousAttempt: lastAttempt,
      newAttempt,
      hintLevel: currentHintLevel
    });
    lastAttempt = newAttempt;
    attemptInput.value = newAttempt;
    newAttemptInput.value = '';
    renderResult(data);
  } catch (error) {
    currentHintLevel = previousLevel;
    showError(error.message);
  } finally {
    setLoading(false);
  }
}

function handleImageSelection(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    showStatus('Choose a PNG, JPG, or WebP image.', 'error');
    imageUpload.value = '';
    return;
  }
  if (file.size > 3 * 1024 * 1024) {
    showStatus('That image is over 3 MB. Please choose a smaller image.', 'error');
    imageUpload.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    selectedImageDataUrl = String(reader.result || '');
    selectedImageName = file.name;
    imagePreview.src = selectedImageDataUrl;
    imageFilename.textContent = file.name;
    imageEmpty.classList.add('hidden');
    imagePreviewWrapper.classList.remove('hidden');
    showStatus('Image added. It will be included when Socratic reviews your work.');
  };
  reader.onerror = () => showStatus('We couldn’t read that image. Please try another file.', 'error');
  reader.readAsDataURL(file);
}

function clearImage() {
  selectedImageDataUrl = '';
  selectedImageName = '';
  imageUpload.value = '';
  imagePreview.removeAttribute('src');
  imageFilename.textContent = '';
  imagePreviewWrapper.classList.add('hidden');
  imageEmpty.classList.remove('hidden');
}

submitButton.addEventListener('click', handleSubmit);
recheckButton.addEventListener('click', handleRecheck);
strongerHintButton.addEventListener('click', handleStrongerHint);
imageUpload.addEventListener('change', handleImageSelection);
removeImageButton.addEventListener('click', clearImage);
