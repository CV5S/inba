document.addEventListener("DOMContentLoaded", () => {
  const footer = document.createElement("footer");
  footer.innerHTML = `
    <div class="footer-right">
      <a href="/index.html">県立印旛諸根具足センター</a>にもどる
       / 
      <a href="https://obsolete.hatenadiary.com/" target="_blank" rel="noopener">良性腫瘍</a>
      / 
      <a href="https://github.com/CV5S/inba" target="_blank" rel="noopener">GitHub Pages</a>
    </div>
  `;
  document.body.appendChild(footer);
});