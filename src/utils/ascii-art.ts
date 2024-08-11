const kittenAsciiArt = [
  `
   /\\_/\\
  ( o.o )
   > ^ <
  `,
  `
    |\\__/,|   (\`\\
  _.|o o  |_   ) )
-(((---(((--------
  `,
  `
   |\\---/|
   | ,_, |
    \\_\`_/-..----.
 ___/ \`   ' ,""+ \\  
(__...'   __\\    |\`.___.';
  (_,...'(_,..\`__)/'.....+
  `
];

export function getRandomKittenAsciiArt(): string {
  const randomIndex = Math.floor(Math.random() * kittenAsciiArt.length);
  return kittenAsciiArt[randomIndex];
}