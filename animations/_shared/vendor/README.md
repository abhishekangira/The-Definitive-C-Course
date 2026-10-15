# vendor

`gsap.min.js` is GSAP 3.15.0, copied unmodified from the `gsap@3.15.0` npm package (`dist/gsap.min.js`),
license header intact (GreenSock "Standard 'no charge' license", https://gsap.com/standard-license).
GSAP only runs inside the headless renderer; it never reaches learners' browsers, because the course
ships rendered MP4 files.

Do not edit it. To upgrade: `npm pack gsap@<version>`, replace the file, and re-render every animation
(`npm run anim:render`): the hash manifest marks them stale automatically.
