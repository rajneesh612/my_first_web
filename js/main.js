const form = document.getElementById('contact-form');
const formResponse = document.getElementById('form-response');

form.addEventListener('submit', async function (e) {
  e.preventDefault();

  console.log("Form submitted"); // debug

  const name = document.getElementById('name').value;
  const email = document.getElementById('email').value;
  const message = document.getElementById('message').value;

  formResponse.textContent = 'Sending...';

  try {
    const res = await fetch('http://localhost:3000/contact', {
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