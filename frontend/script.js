const loginForm = document.querySelector('form');

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        const response = await fetch('http://localhost:3000/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        const result = await response.json();

        if (response.ok) {
            try {
                if (result && typeof result.userId !== 'undefined') {
                    sessionStorage.setItem('userId', String(result.userId));
                    // optional: mirror to localStorage for resilience
                    localStorage.setItem('userId', String(result.userId));
                }
            } catch (e) {
                console.warn('Could not persist userId:', e);
            }
            window.location.href = 'dispensing.html';
        } else {
            alert(`Login failed: ${result.message}`);
        }
    } catch (error) {
        console.error('Error during login:', error);
        alert('Could not connect to server.');
    }
});
