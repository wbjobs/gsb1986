// 异常/状态提示
const container = () => document.getElementById('toast-container');

export function toast(message, level = 'info', duration = 4000) {
  const el = document.createElement('div');
  el.className = `toast ${level}`;
  el.textContent = message;
  container().appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 450);
  }, duration);
  while (container().children.length > 5) container().firstChild.remove();
}

export function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}
