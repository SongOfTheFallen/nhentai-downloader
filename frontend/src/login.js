// Handle login for user and API passwords
const USER_PASSWORD = import.meta.env.VITE_USER_PASSWORD || "";
const API_PASSWORD_ENV = import.meta.env.VITE_API_PASSWORD || "";

const needUser = USER_PASSWORD.length > 0;
const needApi  = API_PASSWORD_ENV.length === 0;

const form = document.getElementById('loginForm');
const userField = document.getElementById('userPassword');
const apiField  = document.getElementById('apiPassword');

if (!needUser) userField.style.display = 'none';
if (!needApi)  apiField.style.display  = 'none';

form.addEventListener('submit', e => {
  e.preventDefault();
  if (needUser) {
    const upw = userField.value;
    if (upw !== USER_PASSWORD) {
      alert('Wrong password');
      return;
    }
    document.cookie = `userAuth=${encodeURIComponent(upw)}; path=/`;
  }
  if (needApi) {
    localStorage.setItem('apiPassword', apiField.value);
  }
  const params = new URLSearchParams(location.search);
  const redir = params.get('redirect') || '/';
  location.href = redir;
});
