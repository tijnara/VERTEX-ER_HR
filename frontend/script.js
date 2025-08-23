const loginForm = document.querySelector('form');

async function performLogin(email, password) {
    if (!email || !password) {
        alert('Email and password are required.');
        return;
    }

    try {
        const response = await fetch('http://100.90.239.104:3000/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });

        const result = await response.json();

        if (response.ok) {
            localStorage.setItem('userId', result.userId);
            window.location.href = 'dispensing.html';
        } else {
            alert(`Login failed: ${result.message}`);
        }
    } catch (error) {
        console.error('Error during login:', error);
        alert('Could not connect to server.');
    }
}

loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    performLogin(email, password);
});

function autoLogin(email, password) {
    console.log('[WebApp] Received credentials for auto-login.');
    document.getElementById('email').value = email;
    document.getElementById('password').value = password;
    performLogin(email, password);
}

window.addEventListener('VOS_CREDENTIALS', (event) => {
    console.log('[WebApp] VOS_CREDENTIALS event received.');
    if (event.detail && event.detail.email && event.detail.password) {
        autoLogin(event.detail.email, event.detail.password);
    }
});

console.log('[WebApp] Login script loaded and ready for manual or auto-login.');