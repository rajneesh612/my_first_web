// Smooth scroll for nav links
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', function (e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

// Contact form handler
const EMAILJS_PUBLIC_KEY = 'dGpHTfnZZFrN90fiX';
const EMAILJS_SERVICE_ID = 'service_xte8xi9';
const EMAILJS_TEMPLATE_ID = 'template_refmn68';

emailjs.init(EMAILJS_PUBLIC_KEY);

const form = document.getElementById('contact-form');
const formResponse = document.getElementById('form-response');
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

form.addEventListener('submit', async function (e) {
  e.preventDefault();

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const message = document.getElementById('message').value.trim();

  if (!name || !email || !message) {
    formResponse.style.color = 'red';
    formResponse.textContent = 'Please fill in all fields.';
    return;
  }

  if (!emailPattern.test(email)) {
    formResponse.style.color = 'red';
    formResponse.textContent = 'Please enter a valid email address.';
    return;
  }

  if (name.length < 2 || message.length < 10) {
    formResponse.style.color = 'red';
    formResponse.textContent = 'Please enter a longer name and message.';
    return;
  }

  formResponse.style.color = '#555';
  formResponse.textContent = 'Sending...';

  try {
    await emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
      name,
      email,
      message
    });

    formResponse.style.color = 'green';
    formResponse.textContent = `Thanks, ${name}! Your message has been sent.`;
    form.reset();
  } catch (error) {
    formResponse.style.color = 'red';
    formResponse.textContent = 'Sorry, something went wrong. Please try again.';
    console.error('EmailJS error:', error);
  }
});

// Highlight active nav link on scroll
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.nav-links a');

window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(section => {
    if (window.scrollY >= section.offsetTop - 80) {
      current = section.getAttribute('id');
    }
  });

  navLinks.forEach(link => {
    link.style.color = link.getAttribute('href') === `#${current}` ? '#e94560' : '#ccc';
  });
});
