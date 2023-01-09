import { getUpdatedStats } from '../firestore/dbFetch.js';
import roomModel from '../modals/roomModal.js';
import { findLoserAndWinner, finishHandApiCall, leaveApiCall } from './game.js';
import mongoose from 'mongoose';

const convertMongoId = (id) => mongoose.Types.ObjectId(id);

// Get deck
export const getDeck = () => {
  const suit = ['H', 'D', 'S', 'C'];
  // Cards (values)
  const values = [
    {
      card: 'A',
      value: [1, 11],
      hasAce: true,
    },
    {
      card: '2',
      value: 2,
    },
    {
      card: '3',
      value: 3,
    },
    {
      card: '4',
      value: 4,
    },
    {
      card: '5',
      value: 5,
    },
    {
      card: '6',
      value: 6,
    },
    {
      card: '7',
      value: 7,
    },
    {
      card: '8',
      value: 8,
    },
    {
      card: '9',
      value: 9,
    },
    {
      card: 'T',
      value: 10,
    },
    {
      card: 'J',
      value: 10,
    },
    {
      card: 'Q',
      value: 10,
    },
    {
      card: 'K',
      value: 10,
    },
  ];
  let deck = [];
  for (let s = 0; s < suit.length; s++) {
    for (let v = 0; v < values.length; v++) {
      let card = { suit: suit[s], value: values[v] };
      deck.push(card);
    }
  }
  return deck;
};

// shuffle deck
export const shuffleDeck = async (shoeSize) => {
  let shoe = [];
  for (let i = 0; i < shoeSize; i++) {
    shoe = [...shoe, ...getDeck()];
  }
  let deckSize = shoe.length;
  let shuffleDeck = [];
  let randIndex;

  for (let i = 0; i < deckSize; i++) {
    randIndex = Math.floor(Math.random() * shoe.length);
    shuffleDeck.push(shoe.splice(randIndex, 1)[0]);
  }
  return shuffleDeck;
};

export const playerTurnTimer = async (io, data) => {
  try {
    const { tableId } = data;
    const room = await roomModel.findOne({ tableId, gamestart: true });
    let currentPlayer = room.players.find((el) => el.turn && el.action === '');
    let currentPlayerIndex = room.players.findIndex(
      (el) => el.turn && el.action === ''
    );
    let time = room.timer;
    let interval = setInterval(async () => {
      if (time > 0) {
        const upRoom = await roomModel.findOne({
          $and: [
            { tableId },
            {
              players: {
                $elemMatch: { id: convertMongoId(currentPlayer?.id) },
              },
            },
          ],
        });
        currentPlayer = upRoom?.players.find(
          (el) => el.id.toString() === currentPlayer.id.toString()
        );
        if (currentPlayer) {
          if (
            currentPlayer &&
            (currentPlayer.action === 'surrender' ||
              currentPlayer.action === 'stand' ||
              currentPlayer.action === 'doubleDown' ||
              currentPlayer.isBusted ||
              currentPlayer.doubleDown ||
              currentPlayer.blackjack)
          ) {
            clearInterval(interval);
            return await nextPlayerTurn(io, currentPlayerIndex, data);
          } else if (
            currentPlayer &&
            (currentPlayer.action === 'hit' || currentPlayer.action === 'split')
          ) {
            clearInterval(interval);
            await roomModel.updateOne(
              {
                $and: [
                  { tableId },
                  {
                    players: {
                      $elemMatch: { id: convertMongoId(currentPlayer.id) },
                    },
                  },
                ],
              },
              {
                'players.$.action': '',
              }
            );
            const updatedRoom = await roomModel
              .findOne({ tableId })
              .select('-deck');
            io.in(tableId).emit('play', updatedRoom);
            return await playerTurnTimer(io, data);
          }
          io.in(tableId).emit('gameTimer', {
            id: currentPlayer?.id,
            time: room.time,
            leftTime: time,
          });
          time--;
        } else {
          clearInterval(interval);
          return await nextPlayerTurn(io, currentPlayerIndex, data, true);
        }
      } else {
        clearInterval(interval);
        io.in(tableId).emit('timeout', {
          name: currentPlayer?.name,
          msg: 'automatic stand',
        });
        if (
          currentPlayer?.isSplitted &&
          currentPlayer?.splitSum.length - 1 > currentPlayer?.splitIndex
        ) {
          currentPlayer.splitIndex += 1;
          let isHasAce = hasAce(currentPlayer?.cards[currentPlayer.splitIndex]);
          let isSame = isSameCards(
            currentPlayer?.cards[currentPlayer?.splitIndex]
          );
          const update = await roomModel.updateOne(
            {
              $and: [
                { tableId: room.tableId },
                { players: { $elemMatch: { id: currentPlayer.id } } },
              ],
            },
            {
              'players.$.turn': true,
              'players.$.splitIndex': currentPlayer.splitIndex,
              'players.$.isSameCard': isSame,
              'players.$.hasAce': isHasAce,
              'players.$.action': '',
            }
          );
          const updatedRoom = await roomModel
            .findOne({ tableId })
            .select('-deck');
          io.in(tableId).emit('play', updatedRoom);
          return await playerTurnTimer(io, data);
        } else await nextPlayerTurn(io, currentPlayerIndex, data);
      }
    }, 1000);
  } catch (err) {
    console.log('Error in player timer =>', err);
  }
};

export const nextPlayerTurn = async (
  io,
  currentPlayerIndex1,
  data,
  isLeave
) => {
  try {
    let currentPlayerIndex = currentPlayerIndex1;
    const room = await roomModel.findOne({
      $and: [{ tableId: data.tableId }, { gamestart: true }],
    });
    console.log('nextPlayer turn =>', currentPlayerIndex);
    let players = room?.players;
    if (!isLeave && players[currentPlayerIndex]) {
      players[currentPlayerIndex].turn = false;
      players[currentPlayerIndex].action = 'stand';
    } else {
      currentPlayerIndex -= 1;
      console.log('player leave =>', currentPlayerIndex);
    }
    if (currentPlayerIndex === room.players.length - 1) {
      setTimeout(async () => {
        await roomModel.updateOne(
          { tableId: data.tableId },
          {
            players,
          }
        );
        const upRoom = await roomModel.findOne({ tableId: data.tableId });
        io.in(data.tableId).emit('updateRoom', upRoom);
        await dealerTurn(io, data);
      }, 500);
    } else if (
      players[currentPlayerIndex + 1]?.blackjack ||
      !players[currentPlayerIndex + 1]?.isPlaying ||
      players[currentPlayerIndex + 1]?.doubleDown
    ) {
      await roomModel.updateOne({ tableId: data.tableId }, { players });
      return await nextPlayerTurn(io, currentPlayerIndex + 1, data);
    } else if (currentPlayerIndex + 1 <= room.players.length) {
      players[currentPlayerIndex + 1].turn = true;
      players[currentPlayerIndex + 1].action = '';
    }
    await roomModel.updateOne({ tableId: data.tableId }, { players });
    const updatedRoom = await roomModel
      .findOne({
        tableId: data.tableId,
        gamestart: true,
      })
      .select('-deck');
    io.in(data.tableId).emit('play', updatedRoom);
    if (currentPlayerIndex !== room.players.length - 1)
      await playerTurnTimer(io, data);
  } catch (error) {
    console.log('Error in nextPlayerTurn =>', error);
  }
};

// Card sum check, natural card check
export const naturals = async (players) => {
  let pl = [...players];
  let i = 0;
  for await (let p of players) {
    // Below is all the scenarios (combinations) the player can get on the first 2 cards
    if (
      p.isPlaying &&
      (Array.isArray(p.cards[0].value.value) ||
        Array.isArray(p.cards[1].value.value))
    ) {
      // Checks if player has a card with an ACE (the ace is an array)

      if (p.cards[0].value.value === 10 || p.cards[1].value.value === 10) {
        // Checks if player has a TEN
        pl[i].blackjack = true;
        pl[i].sum = 21;
        // Multiply player bet by 1.5 (this is the 3:2 ratio)
        // pl[i].wallet = pl[i].wallet + (1.5 * pl[i].betAmount + pl[i].betAmount);
        pl[i].hasAce = true;
        pl[i].turn = false;
        pl[(i + 1) % pl.length].turn = true;
      } else {
        // Checks all cards except for ACE and TEN
        if (pl[i].cards[0].value.hasAce && pl[i].cards[1].value.hasAce) {
          pl[i].sum = [2, 12];
        }
        if (
          pl[i].cards[0].value.card === 'A' &&
          pl[i].cards[1].value.card !== 'A'
        ) {
          pl[i].sum = [p.cards[1].value.value + 1, p.cards[1].value.value + 11];
        } else if (
          pl[i].cards[1].value.card === 'A' &&
          pl[i].cards[0].value.card !== 'A'
        ) {
          pl[i].sum = [p.cards[0].value.value + 1, p.cards[0].value.value + 11];
        }
        pl[i].hasAce = true;
      }
    } else if (pl[i].isPlaying) {
      // All cards except for ACE
      pl[i].sum = pl[i].cards[0].value.value + pl[i].cards[1].value.value;
    }
    i += 1;
  }

  return pl;
};

export const dealerTurn = async (io, data) => {
  try {
    const { tableId } = data;
    const room = await roomModel.findOne({ tableId });
    let dealer = room.dealer;
    let deck = room.deck;
    if (dealer.hasAce === true || deck[0].value.hasAce === true) {
      await dealerAceDeckAce(io, data, room);
    }

    if (!dealer.hasAce && !deck[0].value.hasAce) {
      dealer.sum = dealer.sum + deck[0].value.value; // add sum
      dealer.hasAce = false;
      dealer.cards.push(deck[0]);
      deck.shift();

      await roomModel.updateOne(
        { tableId },
        {
          dealer,
          deck,
        }
      );
      const updatedRoom = await roomModel.findOne({ tableId }).select('-deck');
      io.in(tableId).emit('updateRoom', updatedRoom);
      setTimeout(async () => {
        await outputCardSumDealer(io, data, updatedRoom);
      }, 500);
    }
  } catch (error) {
    console.log('Error in dealerTurn =>', error);
  }
};

// -------Player action ----------------- //
export const hitAction = async (io, socket, data) => {
  try {
    let { tableId, userId } = data;
    console.log('HIT SECTION ', { tableId });
    userId = convertMongoId(userId);
    const room = await roomModel.findOne({
      $and: [
        { tableId },
        { players: { $elemMatch: { $and: [{ id: userId }, { turn: true }] } } },
      ],
    });
    console.log({ room });
    if (room) {
      let player = room.players.find(
        (el) => el.id.toString() === userId.toString()
      );
      let deck = room.deck;
      if (player.hasAce || deck[0].value.hasAce === true) {
        await compareSumAce(io, data, room);
      } else if (player.hasAce || deck[0].value.hasAce === undefined) {
        await compareSum(io, data, room);
      }
    } else {
      const r = await roomModel.findOne({ tableId: tableId });
      io.in(tableId).emit('updateRoom', r);
    }
    console.log('ID HERE ', room);
    const r = await roomModel.findOne({ tableId: tableId });
    let p = r.players.find((el) => el.id.toString() === userId.toString());
    return p;
  } catch (error) {
    console.log('Error in hitAction =>', error);
  }
};

export const standAction = async (io, socket, data) => {
  try {
    const { tableId, userId } = data;
    const room = await roomModel.findOne({
      $and: [
        { tableId },
        {
          players: {
            $elemMatch: {
              $and: [{ id: convertMongoId(userId) }, { turn: true }],
            },
          },
        },
      ],
    });
    if (room) {
      let player = room.players.find((el) => el.turn);
      let currentPlayerIndex = room.players.findIndex(
        (el) => el.turn && el.action === ''
      );
      if (currentPlayerIndex !== -1) {
        if (
          player.isSplitted &&
          player.splitSum.length - 1 > player.splitIndex
        ) {
          player.splitIndex += 1;
          let isHasAce = hasAce(player.cards[player.splitIndex]);
          let isSame = isSameCards(player.cards[player.splitIndex]);
          const update = await roomModel.updateOne(
            {
              $and: [
                { tableId: room.tableId },
                { players: { $elemMatch: { id: player.id } } },
              ],
            },
            {
              'players.$.turn': true,
              'players.$.splitIndex': player.splitIndex,
              'players.$.isSameCard': isSame,
              'players.$.hasAce': isHasAce,
              'players.$.action': 'split',
            }
          );
        } else {
          await roomModel.updateOne(
            {
              $and: [
                { tableId },
                { players: { $elemMatch: { id: player.id } } },
              ],
            },
            {
              'players.$.turn': true,
              'players.$.action': 'stand',
            }
          );
        }
      } else {
        socket.emit('actionError', { msg: 'CurrentPlayer not found' });
      }
    } else {
      const r = roomModel.findOne({ tableId });
      io.in(tableId).emit('updateRoom', r);
    }
  } catch (error) {
    console.log('Error in standAction =>', error);
  }
};

export const doubleAction = async (io, socket, data) => {
  try {
    const { tableId, userId } = data;
    const room = await roomModel.findOne({
      $and: [
        { tableId },
        {
          players: {
            $elemMatch: {
              $and: [{ id: convertMongoId(userId) }, { turn: true }],
            },
          },
        },
      ],
    });
    if (room) {
      let deck = room.deck;
      let player = room.players.find((el) => el.turn);
      let currentPlayerIndex = room.players.findIndex((el) => el.turn);
      if (player.wallet >= player.betAmount * 2) {
        if (player.isSplitted) {
          if (player.hasAce && deck[0].value.hasAce) {
            player.splitSum[player.splitIndex][0] =
              player.splitSum[player.splitIndex][0] + 1; // add sum
            player.splitSum[player.splitIndex][1] =
              player.splitSum[player.splitIndex][1] + 1; // add sum
            player.hasAce = true;
          } else if (!player.hasAce && deck[0].value.hasAce) {
            player.splitSum[player.splitIndex] = [
              player.splitSum[player.splitIndex] + 1,
              player.splitSum[player.splitIndex] + 11,
            ]; // add sum
            player.hasAce = true;
          } else if (player.hasAce && !deck[0].value.hasAce) {
            player.splitSum[player.splitIndex][0] =
              player.splitSum[player.splitIndex][0] + deck[0].value.value; // add sum
            player.splitSum[player.splitIndex][1] =
              player.splitSum[player.splitIndex][1] + deck[0].value.value; // add sum
            player.hasAce = true;
          } else if (!player.hasAce && !deck[0].value.hasAce) {
            player.splitSum[player.splitIndex] =
              player.splitSum[player.splitIndex] + deck[0].value.value; // add sum
            player.hasAce = false;
          }
          player.cards[player.splitIndex].push(deck[0]);
        } else {
          if (player.hasAce && deck[0].value.hasAce) {
            player.sum[0] = player.sum[0] + 1; // add sum
            player.sum[1] = player.sum[1] + 1; // add sum
            player.hasAce = true;
          } else if (!player.hasAce && deck[0].value.hasAce) {
            player.sum = [player.sum + 1, player.sum + 11]; // add sum
            player.hasAce = true;
          } else if (player.hasAce && !deck[0].value.hasAce) {
            player.sum[0] = player.sum[0] + deck[0].value.value; // add sum
            player.sum[1] = player.sum[1] + deck[0].value.value; // add sum
            player.hasAce = true;
          } else if (!player.hasAce && !deck[0].value.hasAce) {
            player.sum = player.sum + deck[0].value.value; // add sum
            player.hasAce = false;
          }
          player.cards.push(deck[0]);
        }
        deck.shift();
        await roomModel.updateOne(
          {
            $and: [
              { tableId },
              { players: { $elemMatch: { id: convertMongoId(userId) } } },
            ],
          },
          {
            $inc: {
              'players.$.wallet': -player.betAmount,
              'players.$.betAmount': player.betAmount,
            },
            'players.$.cards': player.cards,
            'players.$.doubleDown': true,
            'players.$.sum': player.sum,
            'players.$.hasAce': player.hasAce,
            deck,
          }
        );
        const updatedRoom = await roomModel.findOne({ tableId });
        if (player.hasAce) {
          await outputCardSumAce(io, data, updatedRoom);
        } else {
          await outputCardSum(io, data, updatedRoom);
        }
      } else {
        socket.emit('actionError', { msg: 'Not enough balance' });
      }
    } else {
      const r = await roomModel.findOne({ tableId: room.tableId });
      io.in(tableId).emit('updateRoom', r);
    }
    const r = await roomModel.findOne({ tableId: room.tableId });
    let p = r.players.find((el) => el.id.toString() === userId.toString());
    return p;
  } catch (error) {
    console.log('Error in doubleAction =>', error);
  }
};

export const splitAction = async (io, socket, data) => {
  try {
    let { tableId, userId } = data;

    const room = await roomModel.findOne({
      $and: [
        { tableId },
        {
          players: {
            $elemMatch: {
              $and: [{ id: convertMongoId(userId) }, { turn: true }],
            },
          },
        },
      ],
    });
    if (room) {
      let player = room.players.find(
        (el) => el.id.toString() === userId.toString()
      );
      let deck = room.deck;
      let cards = [];
      let splitSum = [];
      if (player.wallet >= player.betAmount * 2) {
        if (player.isSplitted && player.splitIndex !== null) {
          cards.push([player.cards[player.splitIndex].shift(), deck[0]]);
          deck.shift();
          cards.push([player.cards[player.splitIndex].shift(), deck[0]]);
          deck.shift();
          player.cards.splice(player.splitIndex, 1, ...cards);
          cards.forEach((card) => {
            let sum;
            if (card[0].value.hasAce) {
              sum[0] = card[1].value.value + 1;
              sum[1] = card[1].value.value + 11;
            } else if (card[1].value.hasAce) {
              sum[0] = card[0].value.value + 1;
              sum[1] = card[0].value.value + 11;
            } else {
              sum = card[0].value.value + card[1].value.value;
            }
            splitSum.push(sum);
          });
          player.splitSum.splice(player.splitIndex, 1, ...splitSum);
        } else {
          cards.push([player.cards.shift(), deck[0]]);
          deck.shift();
          cards.push([player.cards.shift(), deck[0]]);
          deck.shift();
          cards.forEach((card) => {
            let sum = [];

            if (card[0].value.hasAce) {
              sum[0] = card[1].value.value + 1;
              sum[1] = card[1].value.value + 11;
            } else if (card[1].value.hasAce) {
              sum[0] = card[0].value.value + 1;
              sum[1] = card[0].value.value + 11;
            } else {
              sum = card[0].value.value + card[1].value.value;
            }
            splitSum.push(sum);
          });
          player.splitIndex = 0;
          player.cards = cards;
          player.splitSum = splitSum;
        }

        let isSame = isSameCards(player.cards[player.splitIndex]);
        let isHasAce = hasAce(player.cards[player.splitIndex]);
        player.isSplitted = true;
        await roomModel.updateOne(
          {
            $and: [
              { tableId },
              { players: { $elemMatch: { id: convertMongoId(userId) } } },
            ],
          },
          {
            deck,
            'players.$.cards': player.cards,
            'players.$.splitSum': player.splitSum,
            'players.$.splitIndex': player.splitIndex,
            'players.$.isSplitted': true,
            'players.$.isSameCard': isSame,
            'players.$.hasAce': isHasAce,
            'players.$.turn': true,
            'players.$.action': 'split',
            $inc: {
              'players.$.wallet': -player.betAmount,
              'players.$.betAmount': player.betAmount,
            },
          }
        );
      } else {
        socket.emit('actionError', { msg: 'Not enough balance' });
      }
    } else {
      const r = roomModel.findOne({ tableId });
      io.in(tableId).emit('updateRoom', r);
    }
  } catch (error) {
    console.log('Error in SplitAction =>', error);
  }
};

export const surrender = async (io, socket, data) => {
  try {
    const { tableId, userId } = data;
    const room = await roomModel.findOne({
      $and: [
        { tableId },
        {
          players: {
            $elemMatch: {
              $and: [{ id: convertMongoId(userId) }, { turn: true }],
            },
          },
        },
      ],
    });
    if (room) {
      let player = room.players.find((el) => el.turn);
      let currentPlayerIndex = room.players.findIndex((el) => el.turn);
      if (currentPlayerIndex !== -1) {
        await roomModel.updateOne(
          {
            $and: [
              { tableId },
              { players: { $elemMatch: { id: convertMongoId(userId) } } },
            ],
          },
          {
            'players.$.isSurrender': true,
            'players.$.turn': false,
            'players.$.action': 'surrender',
            $inc: {
              'players.$.wallet': player.betAmount / 2,
            },
          }
        );
      } else {
        socket.emit('actionError', { msg: 'CurrentPlayer not found' });
      }
    } else {
      const r = roomModel.findOne({ tableId });
      io.in(tableId).emit('updateRoom', r);
    }
  } catch (error) {
    console.log('Error in surrender function =>', error);
  }
};

// -----------Player action end -------------//

// compare && output sum for no aces
const outputCardSum = async (io, data, room) => {
  try {
    let player = room.players.find((el) => el.turn);
    player.hasAce = false;
    if (player.isSplitted) {
      if (player.splitSum[player.splitIndex] >= 21) {
        if (player.splitSum.length - 1 > player.splitIndex) {
          player.splitIndex += 1;
          player.hasAce = hasAce(player.cards[player.splitIndex]);
          let isSame = isSameCards(player.cards[player.splitIndex]);
          await roomModel.updateOne(
            {
              $and: [
                { tableId: room.tableId },
                { players: { $elemMatch: { id: player.id } } },
              ],
            },
            {
              'players.$.splitIndex': player.splitIndex,
              'players.$.turn': true,
              'players.$.isSameCard': isSame,
              'players.$.hasAce': player.hasAce,
              'players.$.isActed': false,
              'players.$.action': 'split',
            }
          );
        } else {
          await roomModel.updateOne(
            {
              $and: [
                { tableId: room.tableId },
                { players: { $elemMatch: { id: player.id } } },
              ],
            },
            {
              'players.$.splitIndex': player.splitIndex,
              'players.$.turn': true,
              'players.$.isActed': true,
              'players.$.action': 'stand',
            }
          );
        }
      } else {
        await roomModel.updateOne(
          {
            $and: [
              { tableId: room.tableId },
              { players: { $elemMatch: { id: player.id } } },
            ],
          },
          {
            'players.$.turn': true,
            'players.$.isActed': true,
            'players.$.action': 'hit',
          }
        );
      }
    } else {
      if (player.sum === 21) {
        await roomModel.updateOne(
          {
            $and: [
              { tableId: room.tableId },
              { players: { $elemMatch: { id: player.id } } },
            ],
          },
          {
            'players.$.turn': true,
            'players.$.isActed': true,
            'players.$.action': 'stand',
          }
        );
      } else if (player.sum < 21 && player.doubleDown === false) {
        await roomModel.updateOne(
          {
            $and: [
              { tableId: room.tableId },
              { players: { $elemMatch: { id: player.id } } },
            ],
          },
          {
            'players.$.turn': true,
            'players.$.isActed': true,
            'players.$.action': 'hit',
          }
        );
      } else if (player.sum < 21 && player.doubleDown === true) {
        await roomModel.updateOne(
          {
            $and: [
              { tableId: room.tableId },
              { players: { $elemMatch: { id: player.id } } },
            ],
          },
          {
            'players.$.turn': true,
            'players.$.isActed': true,
            'players.$.action': 'doubleDown',
          }
        );
      } else if (player.sum > 21) {
        await bust(io, data, room);
      }
    }
  } catch (error) {
    console.log('Error in outputCardSum =>', error);
  }
};

// compare && output sum for no aces
const outputCardSumAce = async (io, data, room) => {
  try {
    let player = room.players.find((el) => el.turn);
    if (player.isSplitted) {
      if (player.splitSum[player.splitIndex][1] > 21) {
        player.splitSum[player.splitIndex].pop();
        player.splitSum[player.splitIndex] =
          player.splitSum[player.splitIndex][0];
        player.hasAce = false;
      } else if (player.splitSum[player.splitIndex][1] === 21) {
        player.splitSum[player.splitIndex].shift();
        player.splitSum[player.splitIndex] =
          player.splitSum[player.splitIndex][0];
        player.hasAce = false;
      }

      if (player.splitSum[player.splitIndex] >= 21) {
        if (player.splitSum.length - 1 > player.splitIndex) {
          player.splitIndex += 1;
          player.isActed = false;
          player.hasAce = hasAce(player.cards[player.splitIndex]);
          let isSame = isSameCards(player.cards[player.splitIndex]);
          await roomModel.updateOne(
            {
              $and: [
                { tableId: room.tableId },
                { players: { $elemMatch: { id: player.id } } },
              ],
            },
            {
              'players.$.splitIndex': player.splitIndex,
              'players.$.turn': true,
              'players.$.isSameCard': isSame,
              'players.$.hasAce': player.hasAce,
              'players.$.isActed': false,
              'players.$.action': 'split',
            }
          );
        } else {
          await roomModel.updateOne(
            {
              $and: [
                { tableId: data.tableId },
                {
                  players: { $elemMatch: { id: convertMongoId(data.userId) } },
                },
              ],
            },
            {
              'players.$.sum': player.sum,
              'players.$.splitSum': player.splitSum,
              'players.$.hasAce': player.hasAce,
              'players.$.action': 'stand',
              'players.$.turn': true,
              'players.$.isActed': false,
            }
          );
        }
      } else {
        await roomModel.updateOne(
          {
            $and: [
              { tableId: data.tableId },
              { players: { $elemMatch: { id: convertMongoId(data.userId) } } },
            ],
          },
          {
            'players.$.sum': player.sum,
            'players.$.splitSum': player.splitSum,
            'players.$.hasAce': player.hasAce,
            'players.$.action': 'hit',
            'players.$.turn': true,
            'players.$.isActed': true,
          }
        );
      }
    } else {
      // Check if the higher value is over 21
      if (player.sum[1] > 21) {
        // Remove the high value from the sum & remove array from sum
        player.sum.pop();
        player.sum = player.sum[0];
        player.hasAce = false;
      } else if (player.sum[1] === 21) {
        player.sum.shift();
        player.sum = player.sum[0];
        player.hasAce = false;
      }
      // Take the current value and do the following...
      if (player.sum >= 21) {
        await roomModel.updateOne(
          {
            $and: [
              { tableId: data.tableId },
              { players: { $elemMatch: { id: convertMongoId(data.userId) } } },
            ],
          },
          {
            'players.$.sum': player.sum,
            'players.$.cards': player.cards,
            'players.$.hasAce': player.hasAce,
            'players.$.action': 'stand',
            'players.$.turn': true,
            'players.$.isBusted': player.sum > 21 ? true : false,
          }
        );
      } else if (player.sum < 21 && player.doubleDown === true) {
        await roomModel.updateOne(
          {
            $and: [
              { tableId: data.tableId },
              { players: { $elemMatch: { id: convertMongoId(data.userId) } } },
            ],
          },
          {
            'players.$.sum': player.sum,
            'players.$.cards': player.cards,
            'players.$.hasAce': player.hasAce,
            'players.$.action': 'stand',
            'players.$.turn': false,
            'players.$.isActed': true,
          }
        );
      } else if (player.sum < 21 && player.doubleDown === false) {
        await roomModel.updateOne(
          {
            $and: [
              { tableId: data.tableId },
              { players: { $elemMatch: { id: convertMongoId(data.userId) } } },
            ],
          },
          {
            'players.$.sum': player.sum,
            'players.$.cards': player.cards,
            'players.$.hasAce': player.hasAce,
            'players.$.action': 'hit',
            'players.$.turn': true,
            'players.$.isActed': true,
          }
        );
      }
    }
  } catch (error) {
    console.log('Error in outputcardSumAce =>', error);
  }
};

const outputCardSumAceDealer = async (io, data, room) => {
  let { dealer } = room;
  if (dealer.sum[1] > 21) {
    dealer.sum.pop();
    dealer.sum = dealer.sum[0];
    dealer.hasAce = false;

    if (dealer.sum < 17) {
      setTimeout(async () => {
        await dealerTurn(io, data);
      }, 500);
    } else {
      await finalCompareGo(io, data);
    }
  } else {
    dealer.hasAce = true;

    if (dealer.sum[1] < 17) {
      await dealerTurn(io, data);
    } else {
      await finalCompareGo(io, data);
    }
  }
};

const outputCardSumDealer = async (io, data, room) => {
  let dealer = room.dealer;
  if (dealer.sum < 17) {
    setTimeout(async () => {
      await dealerTurn(io, data);
    }, 500);
  } else {
    await finalCompareGo(io, data);
  }
};

// If player has Ace && deck[0] has Ace
const playerAceDeckAce = async (data, room) => {
  try {
    const { tableId, userId } = data;
    let player = room.players.find((el) => el.turn);
    let deck = room.deck;
    let cards;
    if (player.isSplitted) {
      cards = player.cards[player.splitIndex];
      if (player.hasAce && deck[0].value.hasAce) {
        player.splitSum[player.splitIndex][0] += 1; // add sum
        player.splitSum[player.splitIndex][1] += 1; // add sum
      } else if (!player.hasAce && deck[0].value.hasAce) {
        player.splitSum[player.splitIndex] = [
          player.splitSum[player.splitIndex] + 1,
          player.splitSum[player.splitIndex] + 11,
        ]; // add sum
      } else if (player.hasAce && !deck[0].value.hasAce) {
        player.splitSum[player.splitIndex][0] =
          player.splitSum[player.splitIndex][0] + deck[0].value.value; // add sum
        player.splitSum[player.splitIndex][1] =
          player.splitSum[player.splitIndex][1] + deck[0].value.value; // add sum
      }
      player.cards[player.splitIndex].push(deck[0]);
    } else {
      if (player.hasAce && deck[0].value.hasAce) {
        player.sum[0] = player.sum[0] + 1; // add sum
        player.sum[1] = player.sum[1] + 1; // add sum
      } else if (!player.hasAce && deck[0].value.hasAce) {
        player.sum = [player.sum + 1, player.sum + 11]; // add sum
      } else if (player.hasAce && !deck[0].value.hasAce) {
        player.sum[0] = player.sum[0] + deck[0].value.value; // add sum
        player.sum[1] = player.sum[1] + deck[0].value.value; // add sum
      }
      player.cards.push(deck[0]);
    }
    player.hasAce = true;

    deck.shift();
    await roomModel.updateOne(
      {
        $and: [
          { tableId },
          { players: { $elemMatch: { id: convertMongoId(data.userId) } } },
        ],
      },
      {
        'players.$.sum': player.sum,
        'players.$.cards': player.cards,
        'players.$.hasAce': player.hasAce,
        'players.$.splitSum': player.splitSum,
        'players.$.action': 'hit',
        deck,
      }
    );
  } catch (err) {
    console.log('Error in playerAcedeckAce ->', err);
  }
};

// If dealer has Ace && deck[0] has Ace
const dealerAceDeckAce = async (io, data, room) => {
  try {
    let { tableId, dealer, deck } = room;
    if (dealer.hasAce && deck[0].value.hasAce) {
      dealer.sum[0] = dealer.sum[0] + 1; // add sum
      dealer.sum[1] = dealer.sum[1] + 1; // add sum
      dealer.hasAce = true;
      dealer.cards.push(deck[0]);
      deck.shift();

      await roomModel.updateOne(
        { tableId },
        {
          dealer,
          deck,
        }
      );
    } else if (!dealer.hasAce && deck[0].value.hasAce) {
      dealer.sum = [dealer.sum + 1, dealer.sum + 11]; // add sum
      dealer.hasAce = true;
      dealer.cards.push(deck[0]);
      deck.shift();

      await roomModel.updateOne(
        { tableId },
        {
          dealer,
          deck,
        }
      );
    } else if (dealer.hasAce && !deck[0].value.hasAce) {
      dealer.sum[0] = dealer.sum[0] + deck[0].value.value; // add sum
      dealer.sum[1] = dealer.sum[1] + deck[0].value.value; // add sum
      dealer.hasAce = true;
      dealer.cards.push(deck[0]);
      deck.shift();

      await roomModel.updateOne(
        { tableId },
        {
          dealer,
          deck,
        }
      );
    }
    const updatedRoom = await roomModel.findOne({ tableId }).select('-deck');
    io.in(updatedRoom.tableId).emit('updateRoom', updatedRoom);
    setTimeout(async () => {
      await outputCardSumAceDealer(io, data, updatedRoom);
    }, 500); // compare & output sum for dealer
  } catch (error) {
    console.log('Error in dealerAceDeckAce ->', error);
  }
};

const bust = async (io, data, room) => {
  try {
    let player = room.players.find((el) => el.turn);
    player.isBusted = true;
    await roomModel.updateOne(
      {
        $and: [
          { tableId: data.tableId },
          { players: { $elemMatch: { id: convertMongoId(data.userId) } } },
        ],
      },
      {
        'players.$.isBusted': true,
      }
    );
  } catch (error) {
    console.log('Error in bust =>', error);
  }
};

const compareSumAce = async (io, data, room) => {
  await playerAceDeckAce(data, room); // <--- Check if player has a ACE && next card has ACE
  const updateRoom = await roomModel.findOne({ tableId: data.tableId });
  await outputCardSumAce(io, data, updateRoom);
};

const compareSum = async (io, data, room) => {
  try {
    const { tableId } = data;
    let deck = room.deck;
    let player = room.players.find((el) => el.turn);
    if (player?.isSplitted) {
      player.splitSum[player.splitIndex] += deck[0].value.value;
      player.cards[player.splitIndex].push(deck[0]);
      player.hasAce = false;
    } else {
      player.sum = player.sum + deck[0].value.value; // add sum
      player.hasAce = false;
      player.cards.push(deck[0]);
    }
    deck.shift();
    await roomModel.updateOne(
      {
        $and: [
          { tableId },
          { players: { $elemMatch: { id: convertMongoId(data.userId) } } },
        ],
      },
      {
        'players.$.sum': player.sum,
        'players.$.cards': player.cards,
        'players.$.hasAce': player.hasAce,
        'players.$.splitSum': player.splitSum,
        deck,
      }
    );
    const updatedRoom = await roomModel.findOne({ tableId });
    await outputCardSum(io, data, updatedRoom);
  } catch (error) {
    console.log('Error in compare sum =>', error);
  }
};

// final compare
const finalCompareGo = async (io, data) => {
  console.log('finalCOmpareGo called', data);
  try {
    const { tableId } = data;
    const room = await roomModel.findOne({ tableId });
    let { dealer, players, handWinner } = room;
    let winners = [];
    let draw = [];

    // if dealer sum.length === 2. Fix dealer sum before proceeding
    if (dealer.sum.length === 2 && dealer.sum[1] <= 21) {
      dealer.sum.shift();
      dealer.sum = dealer.sum[0];
    } else if (dealer.sum.length === 2 && dealer.sum[1] > 21) {
      dealer.sum.pop();
      dealer.sum = dealer.sum[0];
    }

    players.forEach((player, i) => {
      console.log('final compare player');
      let sum;
      if (!player.isPlaying) {
        return;
      }
      if (player.isSplitted && player.splitSum.length) {
        player.splitSum.forEach((pl, j) => {
          if (pl.length === 2 && pl[1] <= 21) {
            sum = pl[1];
          } else if (pl.length === 2 && pl[1] > 21) {
            sum = pl[0];
          } else {
            sum = pl;
          }
          players[i].splitSum[j] = sum;
          if (sum > 21) {
            // Devide betAmount by half because when there split so there is two bet of 10 and 10 so the total bet amount is 20
            // and in below scenario the user lost only one split round so this means he loss only 10
            // so what we do we devide the total betAmount by half so we can get current split card loss amount
            players[i].hands.push({
              amount: player.betAmount / 2,
              action: 'game-lose',
              date: new Date(),
              isWatcher: false,
            });
          } else if (sum <= 21 && sum > dealer.sum) {
            // Devide betAmount by half because when there split so there is two bet of 10 and 10 so the total bet amount is 20
            // and in below scenario the user win only one split round so this means he win total 20
            // so what we do we put the actual betAmount because 10 * 2 will be 20
            players[i].hands.push({
              amount: player.betAmount,
              isWatcher: false,
              action: 'game-win',
              date: new Date(),
            });
            // players[i].wallet = player.wallet + player.betAmount * 2;
            winners.push({
              id: player.id,
              name: player.name,
              betAmount: player.betAmount,
              winAmount: player.betAmount,
              action: 'game-win',
            });
          } else if (sum === dealer.sum) {
            players[i].hands.push({
              amount: 0,
              isWatcher: false,
              action: 'game-draw',
              date: new Date(),
            });
            // Because game is draw so it will be not add on in the ticket so Reverting back the winAmount to the user to play
            players[i].wallet = player.wallet + player.betAmount / 2;
            draw.push({
              id: player.id,
              name: player.name,
              action: 'game-draw',
            });
          } else if (dealer.sum > 21 && sum <= 21) {
            players[i].hands.push({
              amount: player.betAmount,
              isWatcher: false,
              action: 'game-win',
              date: new Date(),
            });
            // players[i].wallet = player.wallet + player.betAmount * 2;
            winners.push({
              id: player.id,
              name: player.name,
              betAmount: player.betAmount,
              winAmount: player.betAmount,
              action: 'game-win',
            });
          } else if (sum < dealer.sum && dealer.sum <= 21) {
            players[i].hands.push({
              amount: player.betAmount / 2,
              isWatcher: false,
              action: 'game-lose',
              date: new Date(),
            });
          }
        });
      } else {
        if (player.sum.length === 2 && player.sum[1] <= 21) {
          sum = player.sum[1];
        } else if (player.sum.length === 2 && player.sum[1] > 21) {
          sum = player.sum[0];
        } else {
          sum = player.sum;
        }
        players[i].sum = sum;
        if (player.isSurrender) {
          players[i].hands.push({
            isWatcher: false,
            amount: player.betAmount,
            action: 'game-lose',
            date: new Date(),
          });
          return;
        }
        if (player.blackjack) {
          players[i].hands.push({
            isWatcher: false,
            amount: player.betAmount * 1.5 + player.betAmount,
            action: 'game-win',
            date: new Date(),
          });
          winners.push({
            id: player.id,
            betAmount: player.betAmount,
            winAmount: player.betAmount * 1.5,
            action: 'game-win',
            name: player.name,
          });
        } else if (sum > 21) {
          players[i].hands.push({
            amount: player.betAmount,
            action: 'game-lose',
            date: new Date(),
            isWatcher: false,
          });
        } else if (sum <= 21 && sum > dealer.sum) {
          players[i].hands.push({
            isWatcher: false,
            amount: player.betAmount * 2,
            action: 'game-win',
            date: new Date(),
          });
          // players[i].wallet = player.wallet + player.betAmount * 2;
          winners.push({
            id: player.id,
            name: player.name,
            betAmount: player.betAmount,
            winAmount: player.betAmount,
            action: 'game-win',
          });
        } else if (sum === dealer.sum) {
          players[i].hands.push({
            amount: 0,
            isWatcher: false,
            action: 'game-draw',
            date: new Date(),
          });
          // In case of draw revert the bet amount
          players[i].wallet = player.wallet + player.betAmount;
          draw.push({
            id: player.id,
            name: player.name,
            action: 'game-draw',
          });
        } else if (dealer.sum > 21 && sum <= 21) {
          players[i].hands.push({
            amount: player.betAmount * 2,
            isWatcher: false,
            action: 'game-win',
            date: new Date(),
          });
          // players[i].wallet = player.wallet + player.betAmount * 2;
          winners.push({
            id: player.id,
            name: player.name,
            betAmount: player.betAmount,
            winAmount: player.betAmount,
            action: 'game-win',
          });
        } else if (sum < dealer.sum && dealer.sum <= 21) {
          players[i].hands.push({
            amount: player.betAmount,
            action: 'game-lose',
            date: new Date(),
            isWatcher: false,
          });
        }
      }
    });
    if (winners.length) handWinner.push(winners);
    await roomModel.updateOne(
      { tableId },
      {
        dealer,
        winnerPlayer: winners,
        handWinner,
        players,
        drawPlayers: draw,
      }
    );
    const updatedRoom = await roomModel.findOne({ tableId }).select('-deck');
    console.log('winner scoket trigger');
    io.in(tableId).emit('winner', updatedRoom);
    setTimeout(async () => {
      await resetGame(io, data);
    }, 5000);
  } catch (error) {
    console.log('Error in final compare =>', error);
  }
};

// game reset
export const resetGame = async (io, data) => {
  try {
    console.log('reset called');
    const { tableId } = data;
    const room = await roomModel.findOne({ tableId });
    let players = [];
    let history = room.gameCardStats;
    // find loser and winner and update their win/lose ratio
    // get updated stats
    // update the user stats after each round
    // await findLoserAndWinner(room);
    let currentRoundHistory = {
      players: [],
      dealerCards: room.dealer.cards,
    };

    [1, 2, 3, 4, 5, 6, 7].forEach(async (pl, i) => {
      currentRoundHistory.players.push({
        cards: room.players[i]?.isPlaying ? room.players[i]?.cards : [],
      });
    });
    for await (let player of room.players) {
      // let stats = await getUpdatedStats(player.id);
      players.push({
        ...player,
        cards: [],
        hasAce: false,
        isBusted: false,
        doubleDown: false,
        blackjack: false,
        betAmount: 0,
        isPlaying: false,
        turn: false,
        sum: 0,
        isSameCard: false,
        isSplitted: false,
        splitSum: [],
        splitIndex: null,
        stats: player.stats,
        isSurrender: false,
        isActed: false,
        action: '',
      });
    }
    history.push(currentRoundHistory);
    await roomModel.updateOne(
      {
        tableId,
      },
      {
        gameCardStats: history,
        remainingPretimer: 5,
        gamestart: false,
        players: players,
        preTimer: false,
        winnerPlayer: [],
        drawPlayers: [],
        leaveReq: [],
        dealer: {
          cards: [],
          hasAce: false,
          sum: 0,
        },
      }
    );
    let dd = io.room.findIndex((el) => el.room === tableId);
    if (dd !== -1) {
      io.room[dd].pretimer = false;
    }
    const updatedRoom = await roomModel.findOne({ tableId }).select('-deck');
    //console.log("date =>", updatedRoom.firstGameTime, new Date());
    //let firstGameTime = new Date(updatedRoom.firstGameTime);
    //let now = new Date();
    // await finishHandApiCall(updatedRoom);
    // for min games
    //if ((now - firstGameTime) / (1000 * 60) > 15) {
    //  io.in(tableId).emit("timeCompleted", updatedRoom);
    //  const res = await leaveApiCall(updatedRoom);
    //  if (res) {
    //    await roomModel.deleteOne({
    //      tableId,
    //    });
    //    io.in(tableId).emit("gameFinished", {
    //      msg: "All player left, game finished",
    //    });
    //  }
    //} else {
    io.in(tableId).emit('resetGame', updatedRoom);
    //}
  } catch (error) {
    console.log('Error in resetGame =>', error);
  }
};

export const isSameCards = (cards) => {
  try {
    if (cards[0].value.hasAce && cards[1].value.hasAce) {
      return true;
    } else if (cards[0].value.value === cards[1].value.value) return true;
    else return false;
  } catch (error) {
    console.log('Error in issameCards check =>', error);
  }
};

export const hasAce = (cards) => {
  try {
    if (cards[0].value.hasAce || cards[1].value.hasAce) {
      return true;
    } else return false;
  } catch (error) {
    console.log('Error in hasAce check =>', error);
    return false;
  }
};
