const API_BASE      = import.meta.env.VITE_API_BASE_URL || "http://localhost:5173";
const USER_PASSWORD = import.meta.env.VITE_USER_PASSWORD || "";

function getCookie(name) {
  return document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(name+'='))?.split('=')[1];
}

if (!USER_PASSWORD || getCookie('auth') === '1') {
  // Already authenticated or password disabled
  const params = new URLSearchParams(location.search);
  const redir = params.get('redirect') || '/';
  if (!USER_PASSWORD) location.href = redir === '/login.html' ? '/' : redir;
} 

window.addEventListener('DOMContentLoaded', () => {
  if (!USER_PASSWORD) return;
  const form = document.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const pass = form.querySelector('input[type="password"]').value;
    try {
      const res = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pass })
      });
      if (res.ok) {
        document.cookie = 'auth=1; path=/';
        const params = new URLSearchParams(location.search);
        location.href = params.get('redirect') || '/';
      } else {
        alert('Incorrect password');
        form.reset();
      }
    } catch {
      alert('Login failed');
      form.reset();
    }
  });
});
