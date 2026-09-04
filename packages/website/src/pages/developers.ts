const button = document.getElementById("copy");
if (button) {
  button.addEventListener("click", () => {
    const text = button.dataset["copy"] ?? "";
    void navigator.clipboard?.writeText(text).then(() => {
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy"), 1500);
    });
  });
}
