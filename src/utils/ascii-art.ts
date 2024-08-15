const kittenAsciiArts = [
  `
   /\\___/\\
  ( o   o )
  (  =^=  )
  (        )
  (         )
 (           )
(  /\\     /\\  )
 (  |\\_/|  )
  (  |   |  )
   (/ \\_/ \\)
    \\_____/
  `,
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
  /\\_/\\
=( °w° )=
  )   (  //
 (__ __)//
  `,
];

export function getRandomKittenAsciiArt(): string {
  const randomIndex = Math.floor(Math.random() * kittenAsciiArts.length);
  return kittenAsciiArts[randomIndex];
}

export function generateKittenAsciiArt(): string {
  return getRandomKittenAsciiArt();
}