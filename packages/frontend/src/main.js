// Minimal test without any imports
console.log('JavaScript is executing!');

const root = document.getElementById('root');
if (root) {
  root.innerHTML = `
    <div style="padding: 20px; font-family: Arial; background: #f0f0f0; min-height: 100vh;">
      <h1 style="color: #333;">AAELink Test - JavaScript Working!</h1>
      <p>If you can see this, JavaScript is executing properly.</p>
      <p>Time: ${new Date().toLocaleString()}</p>
      <button onclick="alert('Button works!')" style="padding: 10px; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer;">
        Test Button
      </button>
    </div>
  `;
  console.log('Content rendered successfully');
} else {
  console.error('Root element not found!');
}
