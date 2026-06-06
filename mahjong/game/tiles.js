'use strict';

const SUITS = ['man', 'pin', 'sou'];
const WINDS = ['East', 'South', 'West', 'North'];
const DRAGONS = ['Chun', 'Hatsu', 'Haku']; // Red, Green, White

function buildWall() {
  const tiles = [];
  let id = 0;

  // Number tiles: 3 suits x 9 ranks x 4 copies
  for (const suit of SUITS) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let copy = 0; copy < 4; copy++) {
        tiles.push({ id: id++, suit, rank, type: 'number' });
      }
    }
  }

  // Wind tiles: 4 winds x 4 copies
  for (const wind of WINDS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({ id: id++, suit: 'wind', rank: wind, type: 'honor' });
    }
  }

  // Dragon tiles: 3 dragons x 4 copies
  for (const dragon of DRAGONS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({ id: id++, suit: 'dragon', rank: dragon, type: 'honor' });
    }
  }

  return shuffle(tiles);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function tileKey(tile) {
  return `${tile.suit}-${tile.rank}`;
}

function tileLabel(tile) {
  if (tile.type === 'number') {
    const suitChar = { man: '万', pin: '筒', sou: '条' }[tile.suit];
    return `${tile.rank}${suitChar}`;
  }
  if (tile.suit === 'wind') {
    return { East: '東', South: '南', West: '西', North: '北' }[tile.rank];
  }
  return { Chun: '中', Hatsu: '發', Haku: '白' }[tile.rank];
}

module.exports = { buildWall, tileKey, tileLabel, WINDS };
