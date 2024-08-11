export function generateKittenAsciiArt(): string {
  const kittenArts = [
    `
 /\\_/\\
( o.o )
 > ^ <
    `,
    `
 |\\__/,|   (\`\\
 |_ _  |.--.) )
 ( T   )     /
(((^_(((/(((_/
    `,
    `
    |\\      _,,,---,,_
    /,\`.-'\`'    -.  ;-;;,_
   |,4-  ) )-,_..;\\ (  \`'-'
  '---''(_/--'  \`-'\\_)
    `,
    `
     |\\__/,|   (\`\\
   _.|o o  |_   ) )
 -(((---(((--------
    `
  ];

  const randomIndex = Math.floor(Math.random() * kittenArts.length);
  return kittenArts[randomIndex].trim();
}