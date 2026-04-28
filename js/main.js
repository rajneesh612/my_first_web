const API_BASE = 'http://localhost:3000';

const form = document.getElementById('contact-form');
const formResponse = document.getElementById('form-response');
const loginForm = document.getElementById('login-form');
const loginResponse = document.getElementById('login-response');
const authGate = document.getElementById('auth-gate');
const appContent = document.getElementById('app-content');
const logoutBtn = document.getElementById('logout-btn');
const userBadge = document.getElementById('user-badge');

const setAuthState = (user) => {
  if (user) {
    localStorage.setItem('authUser', JSON.stringify(user));
    if (authGate) {
      authGate.classList.add('hidden');
      authGate.setAttribute('aria-hidden', 'true');
      authGate.style.display = 'none';
    }
    if (appContent) {
      appContent.classList.remove('hidden');
      appContent.removeAttribute('aria-hidden');
      appContent.style.display = 'block';
    }
    if (userBadge) userBadge.textContent = `${user.name || 'User'} (${user.role})`;
  } else {
    localStorage.removeItem('authUser');
    if (authGate) {
      authGate.classList.remove('hidden');
      authGate.removeAttribute('aria-hidden');
      authGate.style.display = 'flex';
    }
    if (appContent) {
      appContent.classList.add('hidden');
      appContent.setAttribute('aria-hidden', 'true');
      appContent.style.display = 'none';
    }
    if (userBadge) userBadge.textContent = 'Signed in';
  }
};

const getStoredUser = () => {
  try {
    return JSON.parse(localStorage.getItem('authUser'));
  } catch (error) {
    return null;
  }
};

const storedUser = getStoredUser();
setAuthState(storedUser);

if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginResponse.textContent = 'Signing in...';

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      if (!res.ok) {
        const errData = await res.json();
        loginResponse.textContent = errData.error || 'Login failed';
        return;
      }

      const user = await res.json();
      loginResponse.textContent = '';
      setAuthState(user);
    } catch (error) {
      console.error(error);
      loginResponse.textContent = 'Server error. Try again.';
    }
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', () => {
    setAuthState(null);
  });
}

form.addEventListener('submit', async function (e) {
  e.preventDefault();

  console.log("Form submitted"); // debug

  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const message = document.getElementById('message').value;

  formResponse.textContent = 'Sending...';

  try {
    const res = await fetch(`${API_BASE}/contact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, message })
    });

    const data = await res.text();
    formResponse.textContent = data;
  } catch (error) {
    console.error(error);
    formResponse.textContent = 'Error sending message';
  }
});