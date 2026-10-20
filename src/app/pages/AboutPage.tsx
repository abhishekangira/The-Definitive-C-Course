import toolchain from '../../generated/toolchain-version.json';
import styles from './Pages.module.css';

export function AboutPage() {
  return (
    <div className={styles.narrow}>
      <h1>About &amp; licenses</h1>
      <p>This course runs entirely in your browser. There is no server and no account. The C compiler is clang, compiled to WebAssembly,
        downloaded once (≈24 MB) and cached. Programs run in a sandboxed Web Worker; your code never leaves your machine.</p>
      <h2>How the answers are checked</h2>
      <p>Every expected output and prediction answer was produced by actually compiling and running the code at build time: in the same
        WebAssembly compiler your browser uses, and on real 64-bit Linux (gcc and clang), macOS and Windows machines. Programs that behave
        differently on a 64-bit computer are flagged and show both results.</p>
      <h2>Third-party software and media</h2>
      <ul>
        <li><strong>LLVM / clang / lld</strong> (via @yowasp/clang {toolchain.version}): Apache-2.0 WITH LLVM-exception. YoWASP packaging: ISC.</li>
        <li><strong>wasi-libc</strong> (including parts of musl): Apache-2.0 WITH LLVM-exception, Apache-2.0, MIT.</li>
        <li><strong>@bjorn3/browser_wasi_shim</strong>: MIT OR Apache-2.0.</li>
        <li><strong>React</strong>, <strong>React Router</strong>, <strong>MDX</strong>, <strong>CodeMirror</strong>, <strong>fflate</strong>: MIT.</li>
        <li><strong>HyperFrames</strong> (animation authoring, build time only): Apache-2.0. <strong>GSAP</strong>: standard no-charge licence (build time only; rendered videos contain no GSAP code).</li>
        <li><strong>Geist</strong> and <strong>Geist Mono</strong> (the page fonts, self-hosted via @fontsource-variable): SIL Open Font License 1.1.</li>
        <li><strong>Fonts in animations</strong>: SIL Open Font License 1.1.</li>
        <li><strong>CS50 lecture clips</strong> are embedded from YouTube (Harvard CS50, CC BY-NC-SA 4.0) and are not re-hosted.</li>
      </ul>
      <p>The course's own code and content: MIT licence, copyright 2026 Abhishek Angira (see the <code>LICENSE</code> file in the repository). The helper header <code>learnc.h</code> is part of the course (MIT).</p>
    </div>
  );
}
