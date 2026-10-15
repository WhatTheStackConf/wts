const TYPING_SPEED = 150;

export function typeText(text: string, show: (value: string) => void, done: () => void) {
  let i = 0;
  const interval = setInterval(() => {
    if (i < text.length) {
      show(text.slice(0, i + 1));
      i++;
    } else {
      clearInterval(interval);
      done();
    }
  }, TYPING_SPEED);
}
