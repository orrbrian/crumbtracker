const toolbar = document.getElementById('vf-toolbar');
const captureBtn = document.getElementById('vf-capture');
const cancelBtn = document.getElementById('vf-cancel');

cancelBtn.addEventListener('click', () => {
  window.ct.viewfinderCancel();
});

captureBtn.addEventListener('click', async () => {
  captureBtn.disabled = true;
  cancelBtn.disabled = true;
  captureBtn.textContent = 'Capturing…';
  try {
    const toolbarHeight = toolbar.getBoundingClientRect().height;
    await window.ct.viewfinderCapture({ toolbarHeight });
    // Main will close this window on success.
  } catch (e) {
    console.error('viewfinder capture error', e);
    captureBtn.disabled = false;
    cancelBtn.disabled = false;
    captureBtn.textContent = 'Capture';
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.ct.viewfinderCancel();
  if (e.key === 'Enter')  captureBtn.click();
});
