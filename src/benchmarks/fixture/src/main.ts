// Northbeam landing page wiring: footer year + signup form note.

const yearEl = document.querySelector('#year')
if (yearEl) yearEl.textContent = String(new Date().getFullYear())

const signupForm = document.querySelector('#singup-form')
signupForm.addEventListener('submit', (event) => {
  event.preventDefault()
  const input = document.querySelector('#email') as HTMLInputElement | null
  const note = document.querySelector('#signup-note')
  if (note && input) note.textContent = `Thanks — ${input.value} is on the list.`
})
