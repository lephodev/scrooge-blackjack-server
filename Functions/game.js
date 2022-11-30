import axios from 'axios';
import jwt from 'jsonwebtoken';
import {
  changeAdmin,
  deductAmount,
  finishedGame,
  finishHandUpdate,
  getDoc,
  removeInvToPlayers,
  updateInGameStatus,
} from '../firestore/dbFetch.js';
import roomModel from '../modals/roomModal.js';
import {
  dealerTurn,
  getDeck,
  isSameCards,
  naturals,
  playerTurnTimer,
  shuffleDeck,
} from './gameLogic.js';
import userModel from './../landing-server/models/user.model.js';
import mongoose from 'mongoose';

const convertMongoId = (id) => mongoose.Types.ObjectId(id);

export const createNewGame = async (io, socket, data) => {
  try {
    console.log('IN CREATE NEW TABLE');
    let {
      nickname,
      photoURI,
      stats,
      userid,
      deduct,
      hands,
      amount,
      meetingToken,
    } = data.user;
    let {
      tableId,
      alloWatchers,
      media,
      admin,
      name,
      invPlayers,
      gameType,
      rTimeout,
      meetingId,
    } = data.table;
    const newRoom = await roomModel.create({
      players: [
        {
          name: nickname,
          wallet: deduct - amount,
          hands: hands,
          cards: [],
          coinsBeforeStart: deduct,
          avatar: photoURI,
          id: convertMongoId(userid),
          betAmount: 0,
          isPlaying: false,
          turn: false,
          sum: 0,
          hasAce: false,
          isBusted: false,
          doubleDown: false,
          blackjack: false,
          isSameCard: false,
          isSplitted: false,
          splitSum: [],
          splitIndex: null,
          stats,
          gameJoinedAt: new Date(),
          meetingToken,
          isSurrender: false,
          isActed: false,
          action: '',
        },
      ],
      remainingPretimer: 5,
      gamestart: false,
      finish: false,
      hostId: admin,
      invPlayers,
      public: data.table.public,
      allowWatcher: alloWatchers,
      media,
      timer: rTimeout,
      gameType,
      gameName: name,
      meetingToken,
      meetingId,
      dealer: {
        cards: [],
        hasAce: false,
        sum: 0,
      },
    });
    if (newRoom) {
      console.log('NEW ROOM CREATED');
      tableId = newRoom.tableId;
      socket.join(tableId);
      let lastSocketData = io.room;
      lastSocketData.push({ room: newRoom.tableId, pretimer: false });
      io.room = [...new Set(lastSocketData.map((ele) => ele.room))].map(
        (el) => {
          return { room: el, pretimer: false };
        }
      );
      console.log({ rooms: io.room });
      socket.customRoom = tableId;
      io.in(tableId).emit('gameCreated', {
        game: newRoom,
        tableId: tableId,
      });
    } else {
      socket.emit('actionError', { msg: 'Unable to create room' });
    }
  } catch (error) {
    console.log('Error in createNewGame =>', error.message);
  }
};

export const joinGame = async (io, socket, data) => {
  try {
    const {
      nickname,
      photoURI,
      stats,
      userid,
      deduct,
      hands,
      amount,
      meetingToken,
    } = data.user;
    const { tableId } = data.table;
    const room = await roomModel.findOne({ tableId });
    if (room.players.find((el) => el.id.toString() === userid?.toString())) {
      return io.in(roomid).emit('updateRoom', room);
    }
    if (room.players.length >= 7) {
      // Max players reached
      socket.emit('slotFull');
      return;
    }

    let players = [...room.players];
    // push new user to players game
    players.push({
      name: nickname,
      isAdmin: false,
      wallet: deduct - amount,
      hands: hands,
      gameJoinedAt: new Date(),
      stats,
      cards: [],
      coinsBeforeStart: deduct,
      avatar: photoURI,
      id: convertMongoId(userid),
      betAmount: 0,
      isPlaying: false,
      turn: false,
      sum: 0,
      hasAce: false,
      isBusted: false,
      doubleDown: false,
      blackjack: false,
      isSameCard: false,
      isSplitted: false,
      splitSum: [],
      splitIndex: null,
      meetingToken,
      isSurrender: false,
      isActed: false,
      action: '',
    });
    // update players array
    const updatedRoom = await roomModel
      .findOneAndUpdate(
        { tableId },
        {
          players,
          $pull: {
            leaveReq: userid,
          },
        },
        { new: true }
      )
      .select('-deck');
    if (updatedRoom) {
      socket.join(tableId);
      socket.emit('joined');
      let lastSocketData = io.room;
      lastSocketData.push({ room: tableId, pretimer: false });
      io.room = [...new Set(lastSocketData.map((ele) => ele.room))].map(
        (el) => {
          return { room: el, pretimer: false };
        }
      );
      console.log('rrr =>', io.room);
      socket.customRoom = tableId;
      io.in(tableId).emit('newPlayer', updatedRoom);
    } else {
      socket.emit('actionError', { msg: 'Unable to Join' });
    }
  } catch (error) {
    console.log('Error in JoinGame =>', error.message);
  }
};

export const rejoinGame = async (io, socket, data) => {
  try {
    // check game is exist and user is in the game
    const { roomId, userId } = data;
    if (roomId && userId) {
      const game = await roomModel.findOne({
        $and: [
          { tableId: roomId },
          { players: { $elemMatch: { id: convertMongoId(userId) } } },
        ],
      });
      if (game) {
        socket.join(roomId);
        io.in(roomId).emit('updateRoom', game);
      } else {
        socket.emit('notJoin');
      }
    }
  } catch (error) {
    console.log('Error in rejoinGame =>', error.message);
  }
};

export const bet = async (io, socket, data) => {
  try {
    // check game is exist and user is in the game
    let { roomId, userId, betAmount } = data;
    userId = convertMongoId(userId);
    console.log({ roomId, userId, betAmount });
    if (roomId && userId) {
      const game = await roomModel.findOne({
        $and: [
          { tableId: roomId },
          { players: { $elemMatch: { id: convertMongoId(userId) } } },
          { gamestart: false },
        ],
      });
      console.log({ game });
      if (!game) return socket.emit('gameAlreadyStarted');
      if (
        game.players.find((el) => el.id.toString() === userId.toString())
          .wallet >= betAmount
      ) {
        const bet = await roomModel.updateOne(
          {
            $and: [
              { tableId: roomId },
              { players: { $elemMatch: { id: userId } } },
            ],
          },
          {
            $inc: {
              'players.$.betAmount': betAmount,
              'players.$.wallet': -betAmount,
            },
          }
        );
        console.log({ bet });
        if (bet.matchedCount === 1) {
          const latestBet = await roomModel
            .findOne({
              $and: [
                { tableId: roomId },
                { players: { $elemMatch: { id: userId } } },
              ],
            })
            .select('-deck');
          console.log({ latestBet });
          io.in(roomId).emit('updateRoom', latestBet);
        } else {
          console.log('Action error');
          socket.emit('actionError', {
            msg: 'Unable to bet',
          });
        }
      } else {
        console.log('Low balance issue');
        socket.emit('lowBalance');
      }
    }
  } catch (error) {
    console.log('Error in bet =>', error.message);
  }
};

export const clearBet = async (io, socket, data) => {
  try {
    // check game is exist and user is in the game
    const { roomId, userId } = data;
    if (roomId && userId) {
      const room = await roomModel.findOne({
        $and: [
          { tableId: roomId },
          { players: { $elemMatch: { id: convertMongoId(userId) } } },
        ],
      });
      if (room.gamestart) {
        return socket.emit('notClearBet', {
          msg: 'Unable to clear, game already started',
        });
      }
      const bet = await roomModel.updateOne(
        {
          $and: [
            { tableId: roomId },
            { players: { $elemMatch: { id: convertMongoId(userId) } } },
            { isGameStarted: false },
          ],
        },
        {
          $inc: {
            'players.$.betAmount': -room.players.find(
              (el) => el.id.toString() === userId.toString()
            ).betAmount,
            'players.$.wallet': room.players.find(
              (el) => el.id.toString() === userId.toString()
            ).betAmount,
          },
        }
      );
      if (bet.matchedCount === 1) {
        const room = await roomModel.findOne({
          $and: [
            { tableId: roomId },
            { players: { $elemMatch: { id: convertMongoId(userId) } } },
          ],
        });
        io.in(roomId).emit('updateRoom', room);
      } else {
        socket.emit('actionError', {
          msg: 'Unable to clear bet',
        });
      }
    }
  } catch (error) {
    console.log('Error in clearBet =>', error.message);
  }
};

export const exitRoom = async (io, socket, data) => {
  try {
    const { tableId, userId } = data;
    let leaveReq = [];
    let roomdata = await roomModel
      .findOne({
        $and: [
          { tableId },
          { players: { $elemMatch: { id: convertMongoId(userId) } } },
        ],
      })
      .lean();
    if (roomdata && roomdata.players.length <= 1) {
      const res = await leaveApiCall(roomdata);
      if (res) {
        await roomModel.deleteOne({
          tableId,
        });
        io.in(tableId).emit('gameFinished', {
          msg: 'All player left, game finished',
        });
      }
    } else if (roomdata && roomdata.players.length) {
      let newAdmin = roomdata.players.find(
        (el) => el.id.toString() !== userId.toString()
      );
      let leaveUser = roomdata.players.find(
        (el) => el.id.toString() === userId.toString()
      );
      leaveReq = [...roomdata.leaveReq];
      leaveReq.push(leaveUser.id);
      if (roomdata.hostId.toString() === userId.toString())
        if (res) {
          // await changeAdmin(newAdmin.id, tableId, roomdata.gameType);
          // const res = await leaveApiCall(
          //   {
          //     ...roomdata,
          //     hostId: roomdata.hostId === userId ? newAdmin.id : roomdata.hostId,
          //   },
          //   leaveUser.id
          // );
          const leave = await roomModel.updateOne(
            {
              tableId,
            },
            {
              hostId:
                roomdata.hostId.toString() === userId.toString()
                  ? newAdmin.id
                  : roomdata.hostId,
              leaveReq,
              $pull: {
                players: userId,
              },
            }
          );
          if (leave.matchedCount === 1) {
            const room = await roomModel.findOne({
              $and: [{ tableId }],
            });
            socket.emit('exitSuccess');
            if (room && room.players.length) {
              io.in(tableId).emit('updateRoom', room);
            } else {
              await roomModel.deleteOne({
                tableId,
              });
              io.in(tableId).emit('gameFinished', {
                msg: 'All player left, game finished',
              });
            }
          }
        }
    } else {
      let roomdata = await roomModel.findOne({ tableId }).lean();
      if (
        !roomdata?.players?.find((el) => el.id.toString() === userId.toString())
      ) {
        // updateInGameStatus(userId);
        socket.emit('exitSuccess');
      }
    }
  } catch (error) {
    console.log('Error in exitRoom =>', error.message);
  }
};

export const startPreGameTimer = async (io, socket, data) => {
  try {
    const { tableId } = data;
    console.log('beofre imer');
    let interval = setInterval(async () => {
      const room = await roomModel.findOne({
        $and: [{ tableId }, { gamestart: false }],
      });
      if (room?.remainingPretimer >= 0) {
        io.in(tableId).emit('preTimer', {
          timer: 5,
          remainingTime: room.remainingPretimer,
        });
        await roomModel.updateOne(
          { tableId },
          {
            $inc: {
              remainingPretimer: -1,
            },
          }
        );
      } else {
        clearInterval(interval);
        io.in(tableId).emit('gameStarted');
        setTimeout(async () => {
          await startGame(io, data);
        }, 500);
      }
    }, 1000);
  } catch (error) {
    console.log('Error in startPreGameTimer =>', error.message);
  }
};

export const confirmBet = async (io, socket, data) => {
  try {
    let { tableId, userId } = data;
    userId = convertMongoId(userId);
    const room = await roomModel.findOne({
      $and: [
        { tableId },
        { gamestart: false },
        { remainingPretimer: { $gt: 1 } },
      ],
    });
    if (!room) return socket.emit('gameAlreadyStarted');
    const player = room.players.find(
      (el) => el.id.toString() === userId.toString()
    );
    if (player && room) {
      await roomModel.updateOne(
        { $and: [{ tableId }, { players: { $elemMatch: { id: userId } } }] },
        {
          'players.$.isPlaying': true,
        }
      );
      if (!io.room.find((el) => el.room === tableId)?.pretimer) {
        let dd = io.room.findIndex((el) => el.room === tableId);
        console.log('dddd =>', { room: io.room, tableId, dd });
        if (dd !== -1) {
          io.room[dd].pretimer = true;
          await roomModel.updateOne({ tableId }, { preTimer: true });
          await startPreGameTimer(io, socket, data);
        }
      }
      const updatedRoom = await roomModel.findOne({ tableId }).select('-deck');
      io.in(tableId).emit('playerReady', {
        name: player.name,
        room: updatedRoom,
        userId: player.id,
      });
    }
  } catch (error) {
    console.log('Error in confirm bet =>', error.message);
  }
};

export const startGame = async (io, data) => {
  try {
    const { tableId } = data;
    let room = await roomModel.findOne({
      tableId,
    });
    if (room && !room.gamestart) {
      let history = room.gameCardStats;
      let deck = room.deck;
      if (deck.length < 52) {
        deck = await shuffleDeck(2);
        history = [];
      }
      let players = room.players;
      let dealer = room.dealer;
      [1, 2].forEach((item) => {
        players.forEach((player, i) => {
          if (player.isPlaying) {
            // if (players[i].cards.length) {
            //   let card = deck.findIndex(
            //     (el) => el.value.value === players[i].cards[0].value.value
            //   );
            //   players[i].cards.push(deck.splice(card, 1)[0]);
            // } else {
            players[i].cards.push(deck[0]);
            deck.shift();
            // }
            if (players[i].cards.length === 2) {
              players[i].isSameCard = isSameCards(players[i].cards);
            }
          } else if (!player.isPlaying && player.betAmount) {
            players[i].wallet = players[i].wallet + player.betAmount;
            players[i].betAmount = 0;
          }
        });
        if (item === 1) {
          dealer.cards.push(deck[0]);
          deck.shift();
          dealer.sum = dealer.cards[0].value.value;
          dealer.hasAce = dealer.cards[0].value.hasAce;
        }
      });
      players = await naturals(players);
      let firstPlayingPLayer = players.findIndex(
        (el) => el.isPlaying && !el.blackjack
      );

      if (firstPlayingPLayer !== -1) {
        players[firstPlayingPLayer].turn = true;
        await roomModel.updateOne(
          { tableId },
          {
            gamestart: true,
            players,
            dealer,
            deck,
            gameCardStats: history,
            firstGameTime: room.firstGameTime ? room.firstGameTime : new Date(),
          }
        );
        const updatedRoom = await roomModel
          .findOne({ tableId })
          .select('-deck');
        io.in(tableId).emit('play', updatedRoom);
        await playerTurnTimer(io, data);
      } else {
        await roomModel.updateOne(
          { tableId },
          { gamestart: true, players, dealer, deck }
        );
        const updatedRoom = await roomModel
          .findOne({ tableId })
          .select('-deck');
        io.in(tableId).emit('play', updatedRoom);
        await dealerTurn(io, data);
      }
    } else {
      // socket.emit("noRoom");
      console.log('no room');
    }
  } catch (error) {
    console.log('Error in startGame =>', error);
  }
};

export const checkForTable = async (data, socket, io) => {
  try {
    const { room, gameType, user } = data;
    if (!room.roomid) return;
    let hands = [];
    let amount = 0;
    let meetingToken;
    let meetingId;
    if (room.table.media !== 'no-media') {
      amount = room.table.media === 'video' ? 400 : 100;
      hands.push({
        amount,
        action: `${room.table.media}-game`,
        date: new Date(),
        isWatcher: false,
      });
      const API_KEY = process.env.VIDEOSDK_API_KEY;
      const SECRET_KEY = process.env.VIDEOSDK_SECRET_KEY;

      const options = { expiresIn: '10d', algorithm: 'HS256' };

      const payload = {
        apikey: API_KEY,
        permissions: ['ask_join'], // also accepts "ask_join"
      };

      meetingToken = jwt.sign(payload, SECRET_KEY, options);
    }
    let isRoomExist = await roomModel
      .findOne({ tableId: room.roomid })
      .select('-deck');
    if (isRoomExist) {
      if (
        room.table.isGameFinished ||
        isRoomExist.finish ||
        room.table.status === 'empty'
      ) {
        return socket.emit('gameFinished', 'Game Already Finished.');
      }
      if (
        isRoomExist.players.find(
          (ele) => ele.id.toString() === user.userid.toString()
        ) ||
        isRoomExist.watchers.find(
          (ele) => ele.id.toString() === user.userid.toString()
        )
      ) {
        socket.join(room.roomid);
        io.in(room.roomid).emit('updateRoom', isRoomExist);
        setTimeout(() => {
          socket.emit('welcome');
        }, 1000);
      } else {
        if (room.table.public) {
          if (isRoomExist.players.length >= 7 && !room.table.alloWatchers) {
            return socket.emit('slotFull');
          } else if (isRoomExist.players.length < 7) {
            user.isAdmin = false;
            // const deduct = await deductAmount(
            //   room.table.buyIn,
            //   user.userid,
            //   gameType
            // );
            const deduct = 10000;
            if (deduct) {
              await joinGame(io, socket, {
                user: { ...user, deduct, hands, amount, meetingToken },
                table: { ...room.table, tableId: room.roomid },
              });
              await removeInvToPlayers(room.roomid, user.userid, gameType);
              setTimeout(() => {
                socket.emit('welcome');
              }, 1000);
            } else {
              socket.emit('lowBalance', {
                userid: user.userid,
              });
            }
          }
        } else {
          if (isRoomExist.players.length >= 7 && !room.table.alloWatchers) {
            return socket.emit('slotFull');
          } else if (
            room.invPlayers.find(
              (ele) => ele.toString() === user.userid.toString()
            ) &&
            !room.players.find(
              (ele) => ele.toString() === user.userid.toString()
            )
          ) {
            user.isAdmin = false;
            const deduct = await deductAmount(
              room.table.buyIn,
              user.userid,
              gameType
            );
            if (deduct) {
              await joinGame(io, socket, {
                user: { ...user, deduct, hands, amount, meetingToken },
                table: { ...room.table, tableId: room.roomid },
              });
              await removeInvToPlayers(room.roomid, user.userid, gameType);
              setTimeout(() => {
                socket.emit('welcome');
              }, 1000);
            } else {
              socket.emit('lowBalance', {
                userid: user.userid,
              });
            }
          } else {
            socket.emit(
              'privateTable',
              'This is private table and you are not invited.'
            );
          }
        }
      }
    } else {
      if (room.table.isGameFinished || room.table.status === 'empty') {
        updateInGameStatus(user.userid);
        return socket.emit('gameFinished', 'Game Already Finished.');
      }
      if (
        room.table.admin.toString() === user.userid.toString() ||
        room.table.status === 'scheduled'
      ) {
        user.isAdmin = room.table.admin.toString() === user.userid.toString();
        // const deduct = await deductAmount(
        //   room.table.buyIn,
        //   user.userid,
        //   gameType
        // );
        const deduct = 10000;
        if (deduct) {
          if (room.table.media !== 'no-media') {
            const API_KEY = process.env.VIDEOSDK_API_KEY;
            const SECRET_KEY = process.env.VIDEOSDK_SECRET_KEY;

            const options = { expiresIn: '10d', algorithm: 'HS256' };

            const payload = {
              apikey: API_KEY,
              permissions: ['allow_join', 'allow_mod'],
            };

            meetingToken = jwt.sign(payload, SECRET_KEY, options);
            const url = `${process.env.VIDEOSDK_API_ENDPOINT}/api/meetings`;
            const option = {
              method: 'POST',
              headers: { Authorization: meetingToken },
            };
            const result = await axios(url, option);

            meetingId = result.data.meetingId;
          }
          await createNewGame(io, socket, {
            user: { ...user, deduct, hands, amount, meetingToken },
            table: {
              ...room.table,
              tableId: room.roomid,
              gameType,
              meetingId,
              meetingToken: meetingToken,
            },
          });
          await removeInvToPlayers(room.roomid, user.userid, gameType);
          setTimeout(() => {
            socket.emit('welcome');
          }, 1000);
        } else {
          socket.emit('lowBalance', {
            userid: user.userid,
          });
        }
      } else {
        socket.emit('noAdmin', 'Table admin is not available yet');
      }
    }
  } catch (err) {
    console.log('Error in checkRoomForConnectedUser =>', err);
  }
};

export const findLoserAndWinner = async (room) => {
  let player = room.players;
  let winner = room.winnerPlayer;
  let looser = [];
  let winners = [];
  player.forEach((item, i) => {
    if (item.splitSum.length) {
    } else {
    }
    let data = winner.find((ele) => item.id === ele.id);
    if (data) {
      winners.push(item);
    } else {
      looser.push(item);
    }
  });
  // await finishHandUpdate(winners, looser, room.tableId, room.gameType);
};

// export const finishedTableGame = async (room) => {
//   let player;
//   try {
//     const table = await getDoc(room.gameType, room.tableId);
//     if (table.table.status !== "empty") {
//       finishedGame(player, table.table);
//       const dd = await leaveApiCall(room);
//       if (dd || room.finish) await roomModel.deleteOne({ _id: room._id });
//     }
//   } catch (err) {
//     console.log("Error in finished game function =>", err.message);
//   }
// };

//export const leaveApiCall = async (room, user) => {
//  try {
//    let player = room.players;
//    let allUsers = player.concat(room.watchers);
//    if (user) allUsers = [{ ...user }];
//    let users = [];
//    allUsers.forEach((item) => {
//      let uid = item.id;
//      users.push({
//        uid,
//        hands: item.hands,
//        coinsBeforeJoin: item.coinsBeforeStart,
//        gameLeaveAt: new Date(),
//        gameJoinedAt: item.gameJoinedAt,
//        isWatcher: room.watchers.find((ele) => ele.id === uid) ? true : false,
//      });
//    });
//    let payload = {
//      gameColl: room.gameType,
//      tableId: room.tableId,
//      buyIn: room.gameType === "pokerTournament_Tables" ? room.maxchips : 0,
//      playerCount: player.length,
//      users: users,
//      adminUid: room.hostId,
//    };
//    console.log("payload =>", payload);

//    const res = await axios.post(
//      `https://leave-table-t3e66zpola-uc.a.run.app/${user ? "single" : "all"}`,
//      payload,
//      {
//        headers: {
//          "Content-Type": "application/json",
//        },
//      }
//    );
//    console.log("Res leave =>", res.data);
//    if (res.data.error === "no error") {
//      if (user) {
//        await roomModel.updateOne(
//          { _id: room._id, "players.id": user.id },
//          {
//            $pull: {
//              players: { id: user.id },
//            },
//          }
//        );
//      }
//      return true;
//    } else {
//      return false;
//    }
//  } catch (err) {
//    console.log("Error in Leave APi call =>", err.message);
//    return false;
//  }
//};

export const addBuyCoins = async (io, socket, data) => {
  try {
    const { userId, tableId, amt, usd, payMethod, cardNr } = data;
    const room = await roomModel.findOne({ tableId });
    let player = room.players.find(
      (el) => el.id.toString() === userId.toString()
    );
    if (player) {
      player.hands.push({
        action: 'buy-coins',
        amount: amt,
        date: new Date(),
        isWatcher: false,
        usd: usd / 100,
        payMethod,
        cardNr,
      });
      player.wallet = player.wallet + amt;
      await roomModel.updateOne(
        {
          $and: [
            { tableId },
            { players: { $elemMatch: { id: convertMongoId(userId) } } },
          ],
        },
        {
          'players.$.hands': player.hands,
          'players.$.wallet': player.wallet,
        }
      );
      const updatedRoom = await roomModel.findOne({ tableId });
      io.in(tableId).emit('CoinsAdded', {
        userId,
        name: player.name,
        amt,
      });
      io.in(tableId).emit('updatedRoom', updatedRoom);
    } else {
      socket.emit('addFail');
      socket.emit('actionError', { msg: 'Error in add coins' });
    }
  } catch (error) {
    console.log('Error in the addBuyCoins =>', error);
  }
};

export const InvitePlayers = async (io, socket, data) => {
  try {
    let invPlayers = [];
    let newInvPlayers = [];
    const room = await roomModel.findOne({ tableId: data.tableId });
    if (room) {
      invPlayers = room.invPlayers;
      data.invPlayers.forEach((ele) => {
        invPlayers.push(ele.value);
        newInvPlayers.push(ele.value);
      });
    }
    const updateRoom = await roomModel.findOneAndUpdate(
      { tableId: data.tableId },
      {
        invPlayers: invPlayers,
      },
      { new: true }
    );
    if (updateRoom) {
      // const res = await axios.get(
      //   'https://invite2-lobby-t3e66zpola-ue.a.run.app/',
      //   {
      //     params: {
      //       usid: data.userId,
      //       game: data.gameType,
      //       tabId: data.tableId,
      //       toInvite: newInvPlayers.join(','),
      //     },
      //     headers: {
      //       'Content-Type': 'application/json',
      //       origin: socket.handshake.headers.origin,
      //     },
      //   }
      // );
      // if (res.data.error === 'no error') {
      socket.emit('invitationSend', {
        room: updateRoom,
      });
      // } else {
      //   socket.emit('noInvitationSend');
      // }
    }
  } catch (err) {
    console.log('Error in InvitePlayer Function =>', err.message);
  }
};

export const finishHandApiCall = async (room) => {
  try {
    let player = room.players;
    let allUsers = player.concat(room.watchers);
    console.log('players =>', room.players);
    let users = [];

    allUsers.forEach((item) => {
      let uid = item.id ? item.id : item.userid;
      console.log('hands =>', item.hands);
      users.push({
        uid,
        hands: item.hands,
        coinsBeforeJoin: item.coinsBeforeStart,
        gameLeaveAt: new Date(),
        gameJoinedAt: item.gameJoinedAt,
        isWatcher: room.watchers.find(
          (ele) => ele.userid.toString() === uid.toString()
        )
          ? true
          : false,
      });
    });
    let payload = {
      gameColl: room.gameType,
      tableId: room.tableId,
      buyIn: room.gameType === 'pokerTournament_Tables' ? room.maxchips : 0,
      playerCount: player.length,
      users: users,
      adminUid: room.hostId,
    };
    console.log('payload =>', payload, 'finish hand api');

    const res = await axios.post(
      `https://finish-hand-t3e66zpola-uc.a.run.app/`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('Res =>', res.data);
    if (res.data.error === 'no error') {
      let newPlayers = [];
      player.forEach((item) => {
        newPlayers.push({
          ...item,
          hands: [],
          userid: item.id ? item.id : item.userid,
        });
      });
      await roomModel.updateOne(
        { _id: room._id },
        {
          players: newPlayers,
        }
      );

      return true;
    } else {
      return false;
    }
  } catch (err) {
    console.log('Error in finishHand APi call =>', err.message);
    return false;
  }
};

export const leaveApiCall = async (room, userId) => {
  try {
    let player = room.players;
    let url = '';
    if (!userId && room.handWinner.length === 0 && !room.gamestart) {
      url = 'https://leave-table-t3e66zpola-uc.a.run.app/all'; // for all user leave before any hands
    } else if (userId && room.handWinner.length === 0 && !room.gamestart) {
      url = 'https://leave-table-t3e66zpola-uc.a.run.app/single'; // for one user leave before any hands
    } else if (userId && !room.gamestart) {
      url = 'https://leave-tab-v2-posthand-one-t3e66zpola-uc.a.run.app/'; // for one user leave after/before hand
    } else if (userId && room.gamestart) {
      url = 'https://leave-tab-v2-inhand-one-t3e66zpola-uc.a.run.app/'; // for one user leave during hand
    } else {
      url = 'https://leave-tab-v2-posthand-all-t3e66zpola-uc.a.run.app/'; // for all user leave after playing any hand
    }
    let allUsers = player.concat(room.watchers);
    console.log('users =>', allUsers, userId);
    if (userId)
      allUsers = allUsers.filter(
        (ele) => ele.id.toString() === userId.toString()
      );
    let users = [];

    allUsers.forEach((item) => {
      console.log('handss =>', item.hands);
      let hands = item.hands ? [...item.hands] : [];
      if (room.gamestart) {
        hands.push({
          action: 'game-lose',
          amount: item.betAmount,
          date: new Date(),
          isWatcher: room.watchers.find((ele) => ele.userid === uid)
            ? true
            : false,
        });
      }
      let uid = item.id ? item.id : item.userid;
      users.push({
        uid,
        hands:
          url === 'https://leave-tab-v2-posthand-all-t3e66zpola-uc.a.run.app/'
            ? []
            : hands,
        coinsBeforeJoin: item.coinsBeforeStart,
        gameLeaveAt: new Date(),
        gameJoinedAt: item.gameJoinedAt,
        isWatcher: room.watchers.find((ele) => ele.userid === uid)
          ? true
          : false,
      });
    });
    let payload = {
      mode: !room.gamestart ? 'afterHand' : 'duringHand',
      gameColl: room.gameType,
      tableId: room.tableId,
      buyIn: room.gameType === 'pokerTournament_Tables' ? room.maxchips : 0,
      playerCount: player.length,
      users: users,
      adminUid: room.hostId,
    };
    console.log('payload =>', JSON.stringify(payload));

    // const res = await axios.post(url, payload, {
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    // });
    // console.log('Res =>', res.data, url);
    // if (res.data.error === 'no error') {
    //   if (userId) {
    await roomModel.updateOne(
      { _id: room._id, 'players.id': userId },
      {
        $pull: {
          players: { id: userId },
        },
      }
    );
    // }
    return true;
    // } else {
    //   return false;
    // }
  } catch (err) {
    console.log('Error in Leave APi call =>', err.message);
    return false;
  }
};

export const checkRoom = async (data, socket, io) => {
  try {
    const { tableId, userId, gameType } = data;
    const userData = await userModel.findOne({ _id: convertMongoId(userId) });
    console.log({ userData });
    if (!userData) {
      // Check user not found and redirect back
      return;
    }

    const roomData = await roomModel.findOne({ tableId });
    console.log({ roomData });
    const payload = {
      user: {
        nickname: userData.username,
        photoURI: userData.profile,
        stats: { countryCode: 'IN' },
        userid: convertMongoId(userId),
        deduct: 10000,
        hands: [],
        amount: 1000,
        meetingToken: '',
      },
      table: {
        tableId,
        alloWatchers: false,
        media: 'no-media',
        admin: convertMongoId(userId),
        name: 'test game',
        minBet: 500,
        invPlayers: [],
        gameType,
        rTimeout: 40,
        meetingId: '',
        public: true,
        gameTime: 5,
      },
    };
    if (roomData) {
      if (
        roomData.players.find((ele) => ele.id.toString() === userId.toString())
      ) {
        socket.join(tableId);
        io.in(tableId).emit('updateRoom', roomData);
        return;
      }
      joinGame(io, socket, payload);
    } else {
      createNewGame(io, socket, payload);
    }
  } catch (error) {
    console.log('Error in checkRoom =>', error);
  }
};
