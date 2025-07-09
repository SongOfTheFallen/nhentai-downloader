const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:5173";

function getCookie(name) {
  return document.cookie
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(name + '='))?.split('=')[1];
}

window.addEventListener('DOMContentLoaded', async () => {
  let required = false;
  try {
    const resp = await fetch(`${API_BASE}/api/login`);
    const data = await resp.json();
    required = data.required;
  } catch {}

  if (!required || getCookie('auth') === '1') {
    const params = new URLSearchParams(location.search);
    const redir = params.get('redirect') || '/';
    if (!required) location.href = redir === '/login.html' ? '/' : redir;
    else location.href = redir;
    return;
  }

  const form = document.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pass = form.querySelector('input[type="password"]').value;
    const resp = await fetch(`${API_BASE}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });
    if (resp.ok) {
      document.cookie = 'auth=1; path=/';
      const params = new URLSearchParams(location.search);
      location.href = params.get('redirect') || '/';
    } else {
      alert('Incorrect password');
      form.reset();
    }
  });
});

