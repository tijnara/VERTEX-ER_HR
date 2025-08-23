const loginForm = document.querySelector('form');

/**
 * Performs the login by sending credentials to the backend.
 * The backend URL is determined dynamically from the browser's current address.
 * @param {string} email The user's email.
 * @param {string} password The user's password.
 */
async function performLogin(email, password) {
    if (!email || !password) {
        alert('Email and password are required.');
        return;
    }

    try {
        // Dynamically create the API URL based on the hostname used to access the page.
        // This works for localhost, local IP (192.168.0.65), and Tailscale IP.
        const backendHost = window.location.hostname;
        const apiUrl = `http://${backendHost}:3000/api/login`;

        console.log(`Attempting to log in via: ${apiUrl}`);

        const response = await fetch(apiUrl, {
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
        alert('Could not connect to server. Ensure the backend is running and accessible on your network.');
    }
}

// Handles manual login when the user clicks the "Sign In" button.
loginForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    performLogin(email, password);
});

/**
 * Handles auto-login by taking credentials injected from the JavaFX application.
 * @param {string} email The user's email.
 * @param {string} password The user's password.
 */
function autoLogin(email, password) {
    console.log('[WebApp] Received credentials for auto-login.');
    document.getElementById('email').value = email;
    document.getElementById('password').value = password;
    performLogin(email, password);
}

// Listens for the custom event dispatched by your JavaFX application to trigger auto-login.
window.addEventListener('VOS_CREDENTIALS', (event) => {
    console.log('[WebApp] VOS_CREDENTIALS event received.');
    if (event.detail && event.detail.email && event.detail.password) {
        autoLogin(event.detail.email, event.detail.password);
    }
});
