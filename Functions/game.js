import axios from "axios";
import jwt from "jsonwebtoken";
import {
  changeAdmin,
  deductAmount,
  finishedGame,
  finishHandUpdate,
  getDoc,
  removeInvToPlayers,
  updateInGameStatus,
} from "../firestore/dbFetch.js";
import roomModel from "../modals/roomModal.js";
import {
  dealerTurn,
  getDeck,
  isSameCards,
  naturals,
  playerTurnTimer,
  shuffleDeck,
} from "./gameLogic.js";
import userModel from "./../landing-server/models/user.model.js";
import mongoose from "mongoose";
import User from "./../landing-server/models/user.model.js";
import MessageModal from "../modals/messageModal.js";
import transactionModel from "../modals/transactionModal.js";
import Notification from "../modals/NotificationModal.js";
import rankModel from "../modals/rankModal.js";
import BonusModel from "../modals/bonusModel.js";

const convertMongoId = (id) => new mongoose.Types.ObjectId(id);

const addNewuserToIo = (io, socket, userId, tableId) => {
  console.log("--- ADD NEW USER TO IO ----", { userId, tableId });
  io.users = [...new Set([...io.users, userId.toString()])];
  socket.customId = userId;
  socket.customRoom = tableId.toString();
  const lastSocketData = [...io.room];
  lastSocketData.push({ room: tableId.toString() });
  io.room = [...new Set(lastSocketData.map((ele) => ele.room))].map((el) => {
    return { room: el, pretimer: false };
  });
};

export const createNewGame = async (io, socket, data) => {
  try {
    console.log("IN CREATE NEW TABLE");
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
    console.log("USER DATA----->>>", data.user);
    console.log("PHOTOURI in create table", photoURI);

    const newRoom = await roomModel.create({
      players: [
        {
          name: nickname,
          wallet: amount,
          hands: hands,
          cards: [],
          coinsBeforeStart: amount,
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
          action: "",
          isInsured: false,
        },
      ],
      remainingPretimer: 3,
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
      askForInsurance: false,
      actedForInsurace: 0,
    });
    if (newRoom) {
      console.log("NEW ROOM CREATED");
      tableId = newRoom.tableId;
      socket.join(tableId);
      let lastSocketData = io.room;
      lastSocketData.push({ room: newRoom.tableId, pretimer: false });
      await User.updateOne({ _id: convertMongoId(userid) }, { wallet: 0 });
      io.room = [...new Set(lastSocketData.map((ele) => ele.room))].map(
        (el) => {
          return { room: el, pretimer: false };
        }
      );
      addNewuserToIo(io, socket, userid, tableId);
      io.in(tableId).emit("gameCreated", {
        game: newRoom,
        tableId: tableId,
      });
    } else {
      socket.emit("actionError", { msg: "Unable to create room" });
    }
  } catch (error) {
    console.log("Error in createNewGame =>", error.message);
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
      originalWalletBalance,
      ticket,
    } = data.user;

    const { tableId } = data.table;
    console.log("data.user", data.user);
    const room = await roomModel.findOne({ tableId });
    if (room.players.find((el) => el.id.toString() === userid?.toString())) {
      console.log("ALREADY ON THE TABLE ", tableId);
      addNewuserToIo(io, socket, userid, tableId);
      return io.in(tableId).emit("updateRoom", room);
    }
    if (room.players.length >= 7) {
      // Max players reached
      socket.emit("slotFull");
      return;
    }

    


    let players = [...room.players];
    // push new user to players game
    console.log("userid ====>", userid);
    console.log("players ==>", players);
    console.log(
      "finding",
      !players.find((el) => el.id.toString() === userid?.toString())
    );
    if (!players.find((el) => el.id.toString() === userid?.toString())) {
      players.push({
        name: nickname,
        isAdmin: false,
        wallet: amount,
        ticket: ticket,
        hands: hands,
        gameJoinedAt: new Date(),
        stats,
        cards: [],
        coinsBeforeStart: amount,
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
        action: "",
        insuranceAmount: 0,
        isInsured: false,
      });
    }

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
      .select("-deck");
    if (updatedRoom) {
      socket.join(tableId);
      addNewuserToIo(io, socket, userid, tableId);
      socket.emit("joined");
      let lastSocketData = io.room;
      lastSocketData.push({ room: tableId, pretimer: false });
      const userData = await User.findOne({ _id: convertMongoId(userid) });
      let updationObject = {};
      if (room?.gameMode !== "goldCoin") {
        updationObject = {
          wallet: userData?.wallet - amount,
        };
      } else {
        updationObject = {
          goldCoin: userData?.goldCoin - amount,
        };
      }
      console.log("updationObject =====>", updationObject);
      await User.updateOne(
        { _id: convertMongoId(userid) },
        // { wallet: originalWalletBalance - amount }
        updationObject
      );
      io.room = [...new Set(lastSocketData.map((ele) => ele.room))].map(
        (el) => {
          return { room: el, pretimer: false };
        }
      );
      console.log("rrr =>", io.room);
      console.log("NEW PLAYER IN THE GAME ", tableId);
      io.in(tableId).emit("newPlayer", updatedRoom);
    } else {
      socket.emit("actionError", { msg: "Unable to Join" });
    }
  } catch (error) {
    console.log("Error in JoinGame =>", error.message);
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
        addNewuserToIo(io, socket, userId, roomId);
        io.in(roomId).emit("updateRoom", game);
      } else {
        socket.emit("notJoin");
      }
    }
  } catch (error) {
    console.log("Error in rejoinGame =>", error.message);
  }
};

export const makeSliderBet = async (io, socket, data) => {
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
      if (!game) return socket.emit("gameAlreadyStarted");
      const findUser = game.players.find(
        (el) => el.id.toString() === userId.toString()
      );
      const totalWalletBalance = findUser.wallet + findUser.betAmount;
      if (totalWalletBalance >= betAmount) {
        const bet = await roomModel.updateOne(
          {
            $and: [
              { tableId: roomId },
              { players: { $elemMatch: { id: userId } } },
            ],
          },
          {
            $set: {
              "players.$.betAmount": betAmount,
              "players.$.wallet": totalWalletBalance - betAmount,
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
            .select("-deck");
          console.log({ latestBet });
          io.in(roomId).emit("updateRoom", latestBet);
        } else {
          console.log("Action error");
          socket.emit("actionError", {
            msg: "Unable to bet",
          });
        }
      } else {
        console.log("Low balance issue");
        socket.emit("lowBalance");
      }
    }
  } catch (error) {
    console.log("Error in bet =>", error.message);
  }
};

export const bet = async (io, socket, data) => {
  try {
    // check game is exist and user is in the game
    console.log("data", data);
    let { roomId, userId, betAmount, maxBetAmount } = data;

    if (!betAmount) {
      socket.emit("actionError", {
        msg: "Enter bet amount",
      });
      return;
    }

    if (parseFloat(betAmount) < 1) {
      socket.emit("actionError", {
        msg: "Minimum bet amount is 1.",
      });
      return;
    }

    if (betAmount > maxBetAmount) {
      betAmount = maxBetAmount;
    }

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
      console.log("game ===>", { game });
      if (!game) return socket.emit("gameAlreadyStarted");
      if (
        game.players.find((el) => el.id.toString() === userId.toString())
          .wallet >= betAmount
      ) {
        const player = game.players.find(
          (el) => el.id.toString() === userId.toString()
        );
        let crrBetAmt = player?.betAmount;
        console.log("current bet amount", crrBetAmt);
        if (crrBetAmt + betAmount > maxBetAmount) {
          betAmount = maxBetAmount - crrBetAmt;
        }
        const bet = await roomModel.updateOne(
          {
            $and: [
              { tableId: roomId },
              { players: { $elemMatch: { id: userId } } },
            ],
          },
          {
            $inc: {
              "players.$.betAmount": betAmount,
              "players.$.wallet": -betAmount,
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
            .select("-deck");
          console.log({ latestBet });
          io.in(roomId).emit("updateRoom", latestBet);
        } else {
          console.log("Action error");
          socket.emit("actionError", {
            msg: "Unable to bet",
          });
        }
      } else {
        console.log("Low balance issue");
        socket.emit("lowBalance");
      }
    }
  } catch (error) {
    console.log("Error in bet =>", error.message);
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
        return socket.emit("notClearBet", {
          msg: "Unable to clear, game already started",
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
            "players.$.betAmount": -room.players.find(
              (el) => el.id.toString() === userId.toString()
            ).betAmount,
            "players.$.wallet": room.players.find(
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
        io.in(roomId).emit("updateRoom", room);
      } else {
        socket.emit("actionError", {
          msg: "Unable to clear bet",
        });
      }
    }
  } catch (error) {
    console.log("Error in clearBet =>", error.message);
  }
};

export const exitRoom = async (io, socket, data) => {
  try {
    console.log("IN EXIT ROOM");
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
      console.log("IF ! 1");
      const res = await leaveApiCall(roomdata, userId);
      console.log({ res });
      if (res) {
        const noOfRooms = await roomModel.countDocuments({
          public: true,
          finish: false,
          gameMode: roomdata.gameMode,
        });

        console.log("no of rooms ===>", noOfRooms);

        if (noOfRooms > 2) {
          await roomModel.deleteOne({
            tableId,
          });
        }

        let copy = { ...io.typingUser };
        if (copy) {
          for (let key in copy) {
            if (copy[key][tableId]) {
              delete copy[key];
            }
          }
          io.typingUser = copy;
        }
        console.log("GAME FINISHED ON LINE 394");
        io.in(tableId).emit("gameFinished", {
          msg: "All player left, game finished",
        });
      }
    } else if (roomdata && roomdata.players.length) {
      console.log("IN EXIT ROOM 2");
      let newAdmin = roomdata.players.find(
        (el) => el.id.toString() !== userId.toString()
      );
      let leaveUser = roomdata.players.find(
        (el) => el.id.toString() === userId.toString()
      );
      console.log("IN EXIT ROOM 3");
      leaveReq = [...roomdata.leaveReq];
      leaveReq.push(leaveUser.id);
      console.log({
        isAdmin: roomdata.hostId.toString() === userId.toString(),
      });
      // if (roomdata.hostId.toString() === userId.toString()) {
      console.log("IN EXIT 4");
      // if (res) {
      // await changeAdmin(newAdmin.id, tableId, roomdata.gameType);
      const res = await leaveApiCall(
        {
          ...roomdata,
          hostId:
            roomdata.hostId?.toString() === userId?.toString()
              ? newAdmin.id
              : roomdata.hostId,
        },
        leaveUser.id
      );
      const leave = await roomModel.findOneAndUpdate(
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
            players: convertMongoId(userId),
          },
        }
      );

      // console.log({ leave });

      if (leave) {
        const room = await roomModel.findOne({
          $and: [{ tableId }],
        });
        console.log(
          "HERE WORKD",
          JSON.stringify(room.players.find((el) => el.id.toString() === userId))
        );
        socket.emit("exitSuccess");
        if (room && room.players.length) {
          console.log("SEND ROOM DATA IF ANY OF THE PLAYER LEAVES");
          io.in(tableId).emit("updateRoom", room);
        } else {
          const noOfRooms = await roomModel.countDocuments({
            public: true,
            finish: false,
            gameMode: room.gameMode,
          });

          console.log("no of rooms ===>", noOfRooms);
          if (noOfRooms > 4) {
            await roomModel.deleteOne({
              tableId,
            });
          }

          let copy = { ...io.typingUser };
          if (copy) {
            for (let key in copy) {
              if (copy[key][tableId]) {
                delete copy[key];
              }
            }
            io.typingUser = copy;
          }
          console.log("GAME FINISHED ON LINE 458");
          io.in(tableId).emit("gameFinished", {
            msg: "All player left, game finished",
          });
        }
      }
      // }
      // }
    } else {
      console.log("FINAL ELSE");
      let roomdata = await roomModel.findOne({ tableId }).lean();
      if (
        !roomdata?.players?.find((el) => el.id.toString() === userId.toString())
      ) {
        // updateInGameStatus(userId);
        socket.emit("exitSuccess");
      }
    }
  } catch (error) {
    console.log("Error in exitRoom =>", error.message);
  }
};

export const startPreGameTimer = async (io, socket, data) => {
  try {
    const { tableId } = data;
    console.log("beofre imer");
    let interval = setInterval(async () => {
      const room = await roomModel.findOne({
        $and: [{ tableId }, { gamestart: false }],
      });
      if (room?.remainingPretimer >= 0) {
        console.log("REMAINING TIMER ", room.remainingPretimer);
        io.in(tableId).emit("preTimer", {
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
        console.log("GAME STARTED AFTER PRE TIMER");
        io.in(tableId).emit("gameStarted");
        setTimeout(async () => {
          await startGame(io, data);
        }, 500);
      }
    }, 1000);
  } catch (error) {
    console.log("Error in startPreGameTimer =>", error.message);
  }
};

export const confirmBet = async (io, socket, data) => {
  try {
    let { tableId, userId, betAmount } = data;
    userId = convertMongoId(userId);
    const room = await roomModel.findOne({
      $and: [
        { tableId },
        { gamestart: false },
        { remainingPretimer: { $gt: -1 } },
      ],
    });
    console.log("GOT ROOM DATA", !!room);
    if (!room) return socket.emit("gameAlreadyStarted");
    const player = room.players.find(
      (el) => el.id.toString() === userId.toString()
    );
    console.log("GOT player DATA", player);
    if (player && room) {
      if (betAmount < 1 || !betAmount) {
        socket.emit("actionError", {
          msg: "Bet amount should be equal or more than 1",
        });
        return;
      }

      await roomModel.updateOne(
        { $and: [{ tableId }, { players: { $elemMatch: { id: userId } } }] },
        {
          "players.$.isPlaying": true,
          "players.$.betAmount": betAmount,
          "players.$.wallet": player?.wallet - betAmount,
        }
      );
      if (!io.room.find((el) => el.room === tableId)?.pretimer) {
        let dd = io.room.findIndex((el) => el.room === tableId);
        console.log("dddd =>", { room: io.room, tableId, dd });
        if (dd !== -1) {
          io.room[dd].pretimer = true;
          await roomModel.updateOne({ tableId }, { preTimer: true });
          await startPreGameTimer(io, socket, data);
        }
      }
      const updatedRoom = await roomModel.findOne({ tableId }).select("-deck");
      io.in(tableId).emit("playerReady", {
        name: player.name,
        room: updatedRoom,
        userId: player.id,
      });
    }
  } catch (error) {
    console.log("Error in confirm bet =>", error.message);
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

            // if (item === 2) {
            //   const index = deck.findIndex(
            //     (el) => players[i].cards[0].value.card === el.value.card
            //   );
            //   const temp = deck[0];
            //   deck[0] = deck[index];
            //   deck[index] = temp;
            // }

            let index;
            let temp;

            // if (item === 1) {
            // index = deck.findIndex((el) => el.value.card === "A");
            // temp = deck[0];
            // deck[0] = deck[index];
            // deck[index] = temp;
            // }

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

      players = players.map((el) => {
        el.isInsured = false;
        return el;
      });

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
            actedForInsurace: 0,
            askForInsurance: false,
          }
        );
        const updatedRoom = await roomModel
          .findOne({ tableId })
          .select("-deck");
        io.in(tableId).emit("play", updatedRoom);
        await playerTurnTimer(io, data);
      } else {
        await roomModel.updateOne(
          { tableId },
          { gamestart: true, players, dealer, deck }
        );
        const updatedRoom = await roomModel
          .findOne({ tableId })
          .select("-deck");
        io.in(tableId).emit("play", updatedRoom);
        await dealerTurn(io, data);
      }
    } else {
      // socket.emit("noRoom");
      console.log("no room");
    }
  } catch (error) {
    console.log("Error in startGame =>", error);
  }
};

// not in use
export const checkForTable = async (data, socket, io) => {
  console.log("---------------- INSIDE CHECK FOR TABLE --------------");
  try {
    const { room, gameType, user } = data;
    if (!room.roomid) return;
    let hands = [];
    let amount = 0;
    let meetingToken;
    let meetingId;
    if (room.table.media !== "no-media") {
      amount = room.table.media === "video" ? 400 : 100;
      hands.push({
        amount,
        action: `${room.table.media}-game`,
        date: new Date(),
        isWatcher: false,
      });
      const API_KEY = process.env.VIDEOSDK_API_KEY;
      const SECRET_KEY = process.env.VIDEOSDK_SECRET_KEY;

      const options = { expiresIn: "10d", algorithm: "HS256" };

      const payload = {
        apikey: API_KEY,
        permissions: ["ask_join"], // also accepts "ask_join"
      };

      meetingToken = jwt.sign(payload, SECRET_KEY, options);
    }
    let isRoomExist = await roomModel
      .findOne({ tableId: room.roomid })
      .select("-deck");
    if (isRoomExist) {
      if (
        room.table.isGameFinished ||
        isRoomExist.finish ||
        room.table.status === "empty"
      ) {
        console.log("GAMI FINISHED ON LINE 684");
        return socket.emit("gameFinished", "Game Already Finished.");
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
        io.in(room.roomid).emit("updateRoom", isRoomExist);
        setTimeout(() => {
          socket.emit("welcome");
        }, 1000);
      } else {
        if (room.table.public) {
          if (isRoomExist.players.length >= 7 && !room.table.alloWatchers) {
            return socket.emit("slotFull");
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
                socket.emit("welcome");
              }, 1000);
            } else {
              socket.emit("lowBalance", {
                userid: user.userid,
              });
            }
          }
        } else {
          if (isRoomExist.players.length >= 7 && !room.table.alloWatchers) {
            return socket.emit("slotFull");
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
                socket.emit("welcome");
              }, 1000);
            } else {
              socket.emit("lowBalance", {
                userid: user.userid,
              });
            }
          } else {
            socket.emit(
              "privateTable",
              "This is private table and you are not invited."
            );
          }
        }
      }
    } else {
      if (room.table.isGameFinished || room.table.status === "empty") {
        updateInGameStatus(user.userid);
        console.log("GAME FINISHED ON LINE 769");
        return socket.emit("gameFinished", "Game Already Finished.");
      }
      if (
        room.table.admin.toString() === user.userid.toString() ||
        room.table.status === "scheduled"
      ) {
        user.isAdmin = room.table.admin.toString() === user.userid.toString();
        // const deduct = await deductAmount(
        //   room.table.buyIn,
        //   user.userid,
        //   gameType
        // );
        const deduct = 10000;
        if (deduct) {
          if (room.table.media !== "no-media") {
            const API_KEY = process.env.VIDEOSDK_API_KEY;
            const SECRET_KEY = process.env.VIDEOSDK_SECRET_KEY;

            const options = { expiresIn: "10d", algorithm: "HS256" };

            const payload = {
              apikey: API_KEY,
              permissions: ["allow_join", "allow_mod"],
            };

            meetingToken = jwt.sign(payload, SECRET_KEY, options);
            const url = `${process.env.VIDEOSDK_API_ENDPOINT}/api/meetings`;
            const option = {
              method: "POST",
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
            socket.emit("welcome");
          }, 1000);
        } else {
          socket.emit("lowBalance", {
            userid: user.userid,
          });
        }
      } else {
        socket.emit("noAdmin", "Table admin is not available yet");
      }
    }
  } catch (err) {
    console.log("Error in checkRoomForConnectedUser =>", err);
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
        action: "buy-coins",
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
          "players.$.hands": player.hands,
          "players.$.wallet": player.wallet,
        }
      );
      const updatedRoom = await roomModel.findOne({ tableId });
      io.in(tableId).emit("CoinsAdded", {
        userId,
        name: player.name,
        amt,
      });
      io.in(tableId).emit("updatedRoom", updatedRoom);
    } else {
      socket.emit("addFail");
      socket.emit("actionError", { msg: "Error in add coins" });
    }
  } catch (error) {
    console.log("Error in the addBuyCoins =>", error);
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
      const sendMessageToInvitedUsers = [
        ...newInvPlayers.map((el) => {
          return {
            sender: data.userId,
            receiver: el,
            message: `<a href='${process.env.CLIENTURL}/game?gameCollection=Blackjack_Tables&tableid=${data.tableId}'>Click here</a> to play blackjack with me.`,
          };
        }),
      ];

      const sendNotificationToInvitedUsers = [
        ...newInvPlayers.map((el) => {
          return {
            sender: data.userId,
            receiver: el,
            message: `has invited you to play blackjack.`,
            url: `${process.env.CLIENTURL}/game?gameCollection=Blackjack_Tables&tableid=${data.tableId}`,
          };
        }),
      ];

      await MessageModal.insertMany(sendMessageToInvitedUsers);
      await Notification.insertMany(sendNotificationToInvitedUsers);

      socket.emit("invitationSend", {
        room: updateRoom,
      });
      // } else {
      //   socket.emit('noInvitationSend');
      // }
    }
  } catch (err) {
    console.log("Error in InvitePlayer Function =>", err.message);
  }
};

export const finishHandApiCall = async (room) => {
  try {
    let player = room.players;
    let allUsers = player.concat(room.watchers);
    console.log("players =>", room.players);
    let users = [];

    allUsers.forEach((item) => {
      let uid = item.id ? item.id : item.userid;
      console.log("hands =>", item.hands);
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
      buyIn: room.gameType === "pokerTournament_Tables" ? room.maxchips : 0,
      playerCount: player.length,
      users: users,
      adminUid: room.hostId,
    };
    console.log("payload =>", payload, "finish hand api");

    const res = await axios.post(
      `https://finish-hand-t3e66zpola-uc.a.run.app/`,
      payload,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Res =>", res.data);
    if (res.data.error === "no error") {
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
    console.log("Error in finishHand APi call =>", err.message);
    return false;
  }
};

const userTotalWinAmount = async (
  coinsBeforeJoin,
  hands,
  userId,
  roomId,
  wallet,
  usersData,
  gameMode
) => {
  // Wallet balance which user comes with to play the game
  console.log("coinsBeforeJoin ====> " + coinsBeforeJoin);
  let userBalanceNow = wallet ? Number(wallet) : coinsBeforeJoin;
  // let userBalanceNow = coinsBeforeJoin;
  let totalTicketsWin = 0;
  const transactions = [];
  let stats = { win: 0, loss: 0, totalWinAmount: 0, totalLossAmount: 0 };
  let totlBetAmt = 0
  let totlDailySpinAmt = 0

  const user = await User.findOne({
    _id: usersData._id
  });

  const promises = [];

  // userBalanceNow = parseFloat(wallet);
  hands.forEach((elHand) => {
    const {
      action,
      amount,
      betAmount,
      currentWallet,
      previousWallet,
      previousTickets,
      currentTickets,
      prevGoldCoin,
      updatedGoldCoin,
    } = elHand;

    console.log("bet amount ==>", betAmount, user.dailySpinBonus)

    

    if(gameMode !== "goldCoin"){
      if(user.dailySpinBonus >= betAmount) {
        user.dailySpinBonus -= betAmount;
        // nonWithdrawableAmt -= action.amount;
        user.lastBetFrom = {
          betFrom: "dailybonus",
          value: betAmount,
        };

        user.nonWithdrawableAmt =
          user.dailySpinBonus + user.monthlyClaimBonus;
        promises.push(
          BonusModel.updateOne(
            {
              userId: user._id,
              isExpired: false,
              bonusExpirationTime: { $gte: new Date() },
              bonusType: "daily",
              restAmount: { $gt: 0 },
            },
            {
              $inc: {
                wageredAmount: betAmount,
                restAmount: betAmount * -1,
                expiredAmount: betAmount * -1,
              },
            }
          )
        );
      } else if (
        user.dailySpinBonus < betAmount &&
        user.dailySpinBonus !== 0
      ) {
        // nonWithdrawableAmt -= user.dailySpinBonus;
        // const restAmt = betAmount - user.dailySpinBonus;
        
        promises.push(
          BonusModel.updateOne(
            {
              userId: user._id,
              isExpired: false,
              bonusExpirationTime: { $gte: new Date() },
              bonusType: "daily",
              restAmount: { $gt: 0 },
            },
            {
              $inc: {
                wageredAmount: user.dailySpinBonus,
                restAmount: user.dailySpinBonus * -1,
                expiredAmount: user.dailySpinBonus * -1,
              },
            }
          )
        );
        user.dailySpinBonus = 0;

        user.lastBetFrom = {
          betFrom: "dailybonus",
          percentage: 100,
          value: betAmount,
        };

        user.nonWithdrawableAmt =
          user.dailySpinBonus + user.monthlyClaimBonus;
      } else {
        user.lastBetFrom = {};
      }
    }

    // if(action.toLowerCase() === "bet"){
    //   if(user.dailySpinBonus >= action.amount){
    //     user.dailySpinBonus -= action.amount
    //     // nonWithdrawableAmt -= action.amount;
    //     user.lastBetFrom = {
    //       betFrom: 'dailybonus',
    //       value: action.amount
    //     };
    //     user.nonWithdrawableAmt = user.dailySpinBonus + user.monthlyClaimBonus;
    //   }else if(user.dailySpinBonus < action.amount && user.dailySpinBonus !== 0){
    //     // nonWithdrawableAmt -= user.dailySpinBonus;
    //     const restAmt = action.amount - user.dailySpinBonus;
    //     user.dailySpinBonus = 0;
    //     let mnthlyPercntage = 0;
    //     let mnthlyBetAmt = 0;
    //     if(user.monthlyClaimBonus >= restAmt){
    //       mnthlyPercntage = (restAmt * 100) / action.amount;
    //       mnthlyBetAmt = restAmt;
    //       user.monthlyClaimBonus -= restAmt
    //     }else if(user.monthlyClaimBonus > 0){
    //       mnthlyPercntage = (user.monthlyClaimBonus * 100) / action.amount;
    //       mnthlyBetAmt = user.monthlyClaimBonus;
    //       user.monthlyClaimBonus = 0;
    //     }
    //     if(mnthlyBetAmt){
    //       user.lastBetFrom = {
    //         betFrom: 'monthly',
    //         percentage: mnthlyPercntage,
    //         value: mnthlyBetAmt
    //       };
    //       promises.push(
    //         BonusModel.updateMany({
    //           userId: user._id
    //         }, {
    //           $inc: {wageredAmount: mnthlyBetAmt}
    //         })
    //       )
    //     }else{
    //       user.lastBetFrom = {
    //         betFrom: 'dailybonus',
    //         percentage: 100,
    //         value: action.amount
    //       };
    //     }
        
    //     user.nonWithdrawableAmt = user.dailySpinBonus + user.monthlyClaimBonus;
    //   }else if(user.monthlyClaimBonus >= action.amount){
    //     const mnthlyPercntage = 100;
    //     const mnthlyBetAmt = action.amount;
    //     user.monthlyClaimBonus -= restAmt;
    //     user.lastBetFrom = {
    //       betFrom: 'monthly',
    //       percentage: mnthlyPercntage,
    //       value: mnthlyBetAmt
    //     };
    //     user.nonWithdrawableAmt = user.dailySpinBonus + user.monthlyClaimBonus;
    //     promises.push(
    //       BonusModel.updateMany({
    //         userId: user._id
    //       }, {
    //         $inc: {wageredAmount: mnthlyBetAmt}
    //       })
    //     )
    //   }else if(user.monthlyClaimBonus < action.amount && user.monthlyClaimBonus !== 0){
    //     const mnthlyPercntage = (user.monthlyClaimBonus * 100) / action.amount;
    //     const mnthlyBetAmt = user.monthlyClaimBonus;
    //     user.monthlyClaimBonus = 0;
    //     user.lastBetFrom = {
    //       betFrom: 'monthly',
    //       percentage: mnthlyPercntage,
    //       value: mnthlyBetAmt
    //     };
    //     user.nonWithdrawableAmt = user.dailySpinBonus + user.monthlyClaimBonus;
    //     promises.push(
    //       BonusModel.updateMany({
    //         userId: user._id
    //       }, {
    //         $inc: {wageredAmount: mnthlyBetAmt}
    //       })
    //     )
    //   }
    // }else{
    //   if(user?.lastBetFrom?.betFrom === 'monthly'){
    //     const winAmtForMonthly = (user.lastBetFrom/100) * action.amount;
    //     user.monthlyClaimBonus += winAmtForMonthly;
    //     user.nonWithdrawableAmt = user.dailySpinBonus + user.monthlyClaimBonus;
    //   }
    // }

    console.log("usersData ===========>", usersData);
    
    transactions.push({
      userId: usersData,
      roomId,
      amount:
        action === "game-lose" || action === "game-insurance"
          ? -amount
          : amount,
      transactionDetails: {},
      updatedWallet:
        action === "game-lose" || action === "game-insurance"
          ? currentWallet
          : currentWallet + amount,
      transactionType: "blackjack",
      prevWallet: previousWallet,
      prevTicket: previousTickets,
      updatedTicket: currentTickets,
      prevGoldCoin,
      updatedGoldCoin,
      status: action,
    });

    if (action === "game-lose") {
      userBalanceNow -= betAmount;
      stats = {
        ...stats,
        loss: stats.loss + 1,
        totalLossAmount: stats.totalLossAmount + amount ? amount : 0,
      };
    } else if (action === "game-draw") {
      // Because in draw case the amount will be no amount be deduct or increase
      // userBalanceNow -= amount;
    } else if (action === "game-win") {
      stats = {
        ...stats,
        win: stats.win + 1,
        totalWinAmount: stats.totalWinAmount + amount ? amount : 0,
      };
      // Because the amount will be increase in the ticket thats why we are decreasing the
      userBalanceNow -= betAmount;
      totalTicketsWin += amount;
    }
    // console.log("userBalanceNow ==>", userBalanceNow, betAmount);
  });

  console.log("transactions 1==>",transactions);

  if(gameMode !== "goldCoin"){
    await User.findOneAndUpdate({
      _id: user._id
    }, {
      monthlyClaimBonus: user.monthlyClaimBonus,
      nonWithdrawableAmt: user.nonWithdrawableAmt,
      dailySpinBonus: user.dailySpinBonus,
      redeemableAmount: user.redeemableAmount
    });
    await Promise.allSettled(promises);
  }

  return {
    userBalanceNow,
    transactions,
    stats,
    shouldUpdateStats: Object.values(stats).some((el) => el > 0),
    totalTicketsWin,
    totlBetAmt,
    totlDailySpinAmt
  };
};

export const leaveApiCall = async (room, userId) => {
  try {
    let player = room.players;
    console.log({ userId });
    // let url = "";
    // if (!userId && room.handWinner.length === 0 && !room.gamestart) {
    //   url = "https://leave-table-t3e66zpola-uc.a.run.app/all"; // for all user leave before any hands
    // } else if (userId && room.handWinner.length === 0 && !room.gamestart) {
    //   url = "https://leave-table-t3e66zpola-uc.a.run.app/single"; // for one user leave before any hands
    // } else if (userId && !room.gamestart) {
    //   url = "https://leave-tab-v2-posthand-one-t3e66zpola-uc.a.run.app/"; // for one user leave after/before hand
    // } else if (userId && room.gamestart) {
    //   url = "https://leave-tab-v2-inhand-one-t3e66zpola-uc.a.run.app/"; // for one user leave during hand
    // } else {
    //   url = "https://leave-tab-v2-posthand-all-t3e66zpola-uc.a.run.app/"; // for all user leave after playing any hand
    // }

    let allUsers = player.concat(room.watchers);
    // console.log("users =>", allUsers, userId);
    if (userId) {
      allUsers = allUsers.filter(
        (ele) => ele.id.toString() === userId.toString()
      );
    }
    let users = [];

    if (userId) {
      const getUser = allUsers.find((el) =>
        el.id
          ? el.id.toString() === userId.toString()
          : el.userid.toString() === userId.toString()
      );

      if (!getUser) {
        return false;
      }

      let uid = getUser.id ? getUser.id : getUser.userid;
      let hands = getUser.hands ? [...getUser.hands] : [];
      if (room.gamestart) {
        hands.push({
          action: "game-lose",
          betAmount: getUser.betAmount,
          date: new Date(),
          isWatcher: room.watchers.find(
            (ele) => ele.userid.toString() === uid.toString()
          )
            ? true
            : false,
        });
      }
      const user = await User.findOne({ _id: uid });
      users.push({
        uid,
        hands,
        wallet: getUser.wallet,
        coinsBeforeJoin: getUser.coinsBeforeStart,
        gameLeaveAt: new Date(),
        gameJoinedAt: getUser.gameJoinedAt,
        gameMode: user?.gameMode,
        isWatcher: room.watchers.find(
          (ele) => ele.userid.toString() === uid.toString()
        )
          ? true
          : false,
        userId: {
          _id: user._id,
          username: user.username,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          profile: user.profile,
          ipAddress: user.ipAddress,
        },
      });
    } else {
      // allUsers.forEach((item) => {

      // });
      console.log("allUsers ===>", allUsers);
      for await (let item of allUsers) {
        console.log("handss =>", item.wallet);
        let hands = item.hands ? [...item.hands] : [];
        if (room.gamestart) {
          hands.push({
            action: "game-lose",
            betAmount: item.betAmount,
            date: new Date(),
            isWatcher: room.watchers.find((ele) => ele.userid === uid)
              ? true
              : false,
          });
        }
        let uid = item.id ? item.id : item.userid;
        const user = await User.findOne({ _id: uid });
        console.log("user in loop", user);
        users.push({
          uid,
          hands,
          wallet: item.wallet,
          // hands: url === 'https://leave-tab-v2-posthand-all-t3e66zpola-uc.a.run.app/'
          //   ? []
          //   : hands,
          coinsBeforeJoin: item.coinsBeforeStart,
          gameLeaveAt: new Date(),
          gameJoinedAt: item.gameJoinedAt,
          gameMode: user?.gameMode,
          isWatcher: room.watchers.find((ele) => ele.userid === uid)
            ? true
            : false,
        });
      }
    }

    let payload = {
      mode: !room.gamestart ? "afterHand" : "duringHand",
      gameColl: room.gameType,
      tableId: room.tableId,
      buyIn: room.gameType === "pokerTournament_Tables" ? room.maxchips : 0,
      playerCount: player.length,
      users: users,
      adminUid: room.hostId,
    };
    // if (userId) {
    //   const leavingUserData = payload.users.find(
    //     (el) => el.uid.toString() === userId.toString()
    //   );
    //   console.log({ payload: payload.users, leavingUserData });
    //   let userTotalWin = 0;
    //   let userTransaction = [];
    //   let statsData = {};
    //   let canUpdateStats = false;
    //   let totalWinningTickets = 0;
    //   if (leavingUserData) {
    //     const {
    //       userBalanceNow,
    //       transactions,
    //       stats,
    //       shouldUpdateStats,
    //       totalTicketsWin,
    //     } = userTotalWinAmount(
    //       leavingUserData.coinsBeforeJoin,
    //       leavingUserData.hands,
    //       userId,
    //       room.tableId
    //     );
    //     totalWinningTickets = totalTicketsWin;
    //     userTransaction = [...transactions];
    //     userTotalWin = userBalanceNow;
    //     statsData = { ...stats };
    //     canUpdateStats = shouldUpdateStats;
    //   }

    //   console.log(JSON.stringify(userTransaction));

    //   if (userTransaction.length) {
    //     await transactionModel.insertMany(userTransaction);
    //   }
    //   await User.updateOne(
    //     { _id: convertMongoId(userId) },
    //     { $inc: { wallet: userTotalWin, ticket: totalWinningTickets } }
    //   );
    //   if (canUpdateStats) {
    //     await rankModel.updateOne(
    //       {
    //         userId: convertMongoId(userId),
    //         gameName: "blackjack",
    //       },
    //       {
    //         $inc: {
    //           win: statsData.win,
    //           loss: statsData.loss,
    //           totalWinAmount: statsData.totalWinAmount,
    //           totalLossAmount: statsData.totalLossAmount,
    //         },
    //       },
    //       { upsert: true }
    //     );
    //   }

    //   console.log({ userTotalWin });
    // } else {
    const userWinPromise = [];
    let allTransactions = [];
    let statsPromise = [];
    console.log("payload users ===>", payload.users);

    for await(const elUser of payload.users){
      {
        const {
          userBalanceNow,
          transactions,
          stats,
          shouldUpdateStats,
          totalTicketsWin,
          totlBetAmt,
          totlDailySpinAmt
        } = await userTotalWinAmount(
          elUser.coinsBeforeJoin,
          elUser.hands,
          elUser.uid,
          room.tableId,
          elUser.wallet,
          elUser?.userId,
          room?.gameMode
        );
        console.log("transactions ====>", transactions);
        allTransactions = [...allTransactions, ...transactions];
        let updationObject = {};
  
        // if(room?.gameMode !== "goldCoin"){
        //   if(totlBetAmt){
        //     // await BonusModel.updateMany({
        //     //   userId: elUser.uid,
        //     //   isExpired: false,
        //     //   bonusExpirationTime: { $gte: new Date() },
        //     //   bonusType: 'monthly'
        //     // }, {
        //     //   $inc: {
        //     //     wageredAmount: parseFloat(totlBetAmt)
        //     //   }
        //     // });
        //   }
  
        //   if(totlDailySpinAmt){
        //     // await BonusModel.updateMany({
        //     //   userId: elUser.uid,
        //     //   isExpired: false,
        //     //   bonusExpirationTime: { $gte: new Date() },
        //     //   bonusType: 'daily'
        //     // }, {
        //     //   $inc: {
        //     //     wageredAmount: parseFloat(totlDailySpinAmt)
        //     //   }
        //     // });
        //   }
  
        // }
  
  
        if (room?.gameMode !== "goldCoin") {
          updationObject = {
            wallet: elUser?.wallet ? elUser?.wallet : 0,
            // ticket: totalTicketsWin,
          };
        } else {
          updationObject = {
            goldCoin: elUser?.wallet ? elUser?.wallet : 0,
            // ticket: totalTicketsWin,
          };
        }
        console.log("updationObject =====>", !!elUser,updationObject);
        if (elUser)
          userWinPromise.push(
            await User.updateOne(
              { _id: convertMongoId(elUser.uid) },
              {
                $inc: updationObject,
              }
            )
          );
        console.log("line 1443");
        if (shouldUpdateStats) {
          statsPromise.push(
            await rankModel.updateOne(
              {
                userId: convertMongoId(elUser.uid),
                gameName: "blackjack",
              },
              {
                $inc: {
                  win: stats.win,
                  loss: stats.loss,
                  totalWinAmount: stats.totalWinAmount,
                  totalLossAmount: stats.totalLossAmount || 0,
                },
              },
              { upsert: true }
            )
          );
        }
      }
    }

    // payload.users.forEach(async (elUser) => );
    console.log("allTransactions ==>", allTransactions);
    const sttledTrans = await Promise.allSettled([
      ...userWinPromise,
      transactionModel.insertMany(allTransactions),
      ...statsPromise,
    ]);
    console.log("line no 1468",sttledTrans);
    // }

    // const res = await axios.post(url, payload, {
    //   headers: {
    //     'Content-Type': 'application/json',
    //   },
    // });
    // console.log('Res =>', res.data, url);
    // if (res.data.error === 'no error') {
    //   if (userId) {

    console.log("line no 1480");
    await roomModel.updateOne(
      { _id: room._id, "players.id": convertMongoId(userId) },
      {
        $pull: {
          players: { id: convertMongoId(userId) },
        },
      }
    );
    console.log("line no 1489");
    // }
    return true;
    // } else {
    //   return false;
    // }
  } catch (err) {
    console.log("Error in Leave APi call =>", err.message);
    return false;
  }
};

export const checkRoom = async (data, socket, io) => {
  try {
    console.log("data =>", data);
    const { tableId, userId, gameType, sitInAmount, gameMode } = data;
    console.log("vgfg", { data });
    const userData = await userModel.findOne({ _id: convertMongoId(userId) });
    if (!userData) {
      console.log("redirect to client");
      socket.emit("redirectToClient");
      return;
    }

    console.log({ userData });

    const roomData = await roomModel.findOne({ tableId });
    const sitAmount = typeof sitInAmount === "number" ? sitInAmount : 0;
    console.log(
      "checkingggg ===>",
      roomData?.gameMode,
      userData?.goldCoin,
      sitAmount
    );
    if (roomData?.gameMode === "goldCoin" && userData?.goldCoin < sitAmount) {
      return socket.emit("notEnoughtGoldCoin", {
        message: "You don't have enough gold coins.",
      });
    }

    const payload = {
      user: {
        nickname: userData.username,
        photoURI: userData.profile,
        ticket: userData?.ticket,
        stats: { countryCode: "IN" },
        userid: convertMongoId(userId),
        deduct: 0,
        hands: [],
        amount: sitAmount > 0 ? sitAmount : userData.wallet,
        meetingToken: "",
        originalWalletBalance: userData.wallet,
      },
      table: {
        tableId,
        alloWatchers: false,
        media: "no-media",
        admin: convertMongoId(userId),
        name: "test game",
        minBet: 500,
        invPlayers: [],
        gameType,
        rTimeout: 40,
        meetingId: "",
        public: true,
        gameTime: 5,
      },
    };

    if (roomData) {
      // Check if user is in the game
      if (
        roomData.players.find((ele) => ele.id.toString() === userId.toString())
      ) {
        console.log("USER IS ALREADY ON THE TABLE");
        socket.join(tableId);
        addNewuserToIo(io, socket, userId, tableId);
        io.in(tableId).emit("updateRoom", roomData);
        return;
      }

      // if (payload.user.amount < payload.table.minBet) {
      //   socket.emit('actionError', { msg: 'Not enough balance' });
      //   return;
      // }
      // join the user in the game
      console.log("NEW USER JOIN TO THE TABLE");
      if (!sitAmount) {
        return socket.emit("notjoined");
      }
      if (gameMode === "goldCoin") {
        if (
          !sitAmount ||
          sitInAmount < 5 ||
          sitAmount > userData.goldCoin ||
          !/^\d+$/.test(sitInAmount)
        ) {
          socket.emit("redirectToClient");
          return;
        }
      }
      if (gameMode === "token") {
        if (
          !sitAmount ||
          sitInAmount < 5 ||
          sitAmount > userData.wallet ||
          !/^\d+$/.test(sitInAmount)
        ) {
          socket.emit("redirectToClient");
          return;
        }
      }
      // const limit = await checkLimits(userId, gameMode, sitInAmount, userData);
      // console.log("limits ==>", limit);
      // if (!limit?.success) {
      //   io.emit("spendingLimitExceeeds", {
      //     message: limit?.message,
      //   });
      //   return;
      // }

      if(sitAmount > (userData.wallet - userData.monthlyClaimBonus) && roomData?.gameMode !== "goldCoin"){
        return socket.emit("notEnoughtGoldCoin", {
          message: "You can ponly play with One Time Wager and Withdrawable amount",
        });
      }

      joinGame(io, socket, payload);
    } else {
      // if there is no userid and user in some other games so we will redirect user
      const checkUserInOtherTable = await roomModel.findOne({
        "players.id": convertMongoId(userId),
      });
      // Redirect user to the table on which he don't leave the game
      if (checkUserInOtherTable) {
        socket.join(checkUserInOtherTable.tableId);
        let lastSocketData = io.room;
        const checkIfRoomExistsInSocket = lastSocketData.find(
          (el) =>
            el.room.toString() === checkUserInOtherTable.tableId.toString()
        );
        if (!checkIfRoomExistsInSocket) {
          io.room.push({
            room: checkUserInOtherTable.tableId,
            pretimer: checkUserInOtherTable.preTimer,
          });
        }

        addNewuserToIo(io, socket, userId, checkUserInOtherTable.tableId);
        io.in(checkUserInOtherTable.tableId).emit("gameCreated", {
          game: checkUserInOtherTable,
          tableId: checkUserInOtherTable.tableId,
        });
        return;
      }
      // Create new game
      socket.emit("redirectToClient");
    }
  } catch (error) {
    console.log("Error in checkRoom =>", error);
  }
};

export const checkLimits = async (userId, gameMode, sitInAmount, user) => {
  try {
    let crrDate = new Date();
    crrDate.setHours(0);
    crrDate.setMinutes(0);
    crrDate.setMilliseconds(0);
    crrDate = crrDate.toDateString();

    const todayTransactions = await transactionModel.find({
      $and: [
        { userId: userId },
        { createdAt: { $gte: crrDate } },
        { amount: { $lt: 0 } },
      ],
    });
    console.log("todayTransactions =====>", gameMode, todayTransactions);
    if (todayTransactions.length) {
      let spndedToday = 0;
      if (todayTransactions.length === 1) {
        spndedToday =
          gameMode === "goldCoin"
            ? todayTransactions[0].prevGoldCoin -
              todayTransactions[0].updatedGoldCoin
            : todayTransactions[0].prevWallet -
              todayTransactions[0].updatedWallet;
      } else {
        // spndedToday =
        //   gameMode === "goldCoin"
        //     ? todayTransactions[0].updatedGoldCoin -
        //       todayTransactions[todayTransactions.length - 1].updatedGoldCoin
        //     : todayTransactions[0].updatedWallet -
        //       todayTransactions[todayTransactions.length - 1].updatedWallet;
        if (gameMode === "goldCoin") {
          todayTransactions
            .filter((obj) => obj.updatedGoldCoin !== obj.prevGoldCoin)
            .forEach((obj) => {
              spndedToday +=
                parseFloat(obj.prevGoldCoin) - parseFloat(obj.updatedGoldCoin);
            });
        } else {
          todayTransactions
            .filter((obj) => obj.prevWallet !== obj.updatedWallet)
            .forEach((obj) => {
              spndedToday +=
                parseFloat(obj.prevWallet) - parseFloat(obj.updatedWallet);
            });
        }
      }
      // console.log(
      //   "spndedToday =====>",
      //   spndedToday + sitInAmount,
      //   user.dailyGoldCoinSpendingLimit
      // );
      if (
        gameMode === "goldCoin" &&
        spndedToday + sitInAmount > user.dailyGoldCoinSpendingLimit
      ) {
        return {
          success: false,
          message: "Your daily spending limit for goldcoins has been exhausted",
        };
      } else if (
        gameMode === "token" &&
        spndedToday + sitInAmount > user.dailyTokenSpendingLimit
      ) {
        return {
          success: false,
          message: "Your daily spending limit for tokens has been exhausted",
        };
      }
    } else {
      console.log(
        "spndedMonthly =====>",
        sitInAmount,
        user.monthlyGoldCoinSpendingLimit
      );
      if (
        gameMode === "goldCoin" &&
        sitInAmount > user.dailyGoldCoinSpendingLimit
      ) {
        return {
          success: false,
          message: "Your sitin amount is exceeding your daily spending limit",
        };
      } else if (
        gameMode === "token" &&
        sitInAmount > user.dailyTokenSpendingLimit
      ) {
        return {
          success: false,
          message: "Your sitin amount is exceeding your daily spending limit",
        };
      }
    }

    let weeklyStartDate = getLastSunday().toDateString();

    const weeklyTransactions = await transactionModel.find({
      $and: [
        { userId: userId },
        { createdAt: { $gte: weeklyStartDate } },
        { amount: { $lt: 0 } },
      ],
    });

    if (weeklyTransactions.length) {
      let spndedWeekly = 0;
      if (weeklyTransactions.length === 1) {
        spndedWeekly =
          gameMode === "goldCoin"
            ? weeklyTransactions[0].prevGoldCoin -
              weeklyTransactions[0].updatedGoldCoin
            : weeklyTransactions[0].prevWallet -
              weeklyTransactions[0].updatedWallet;
      } else {
        if (gameMode === "goldCoin") {
          weeklyTransactions
            .filter((obj) => obj.updatedGoldCoin !== obj.prevGoldCoin)
            .forEach((obj) => {
              spndedWeekly +=
                parseFloat(obj.prevGoldCoin) - parseFloat(obj.updatedGoldCoin);
            });
        } else {
          weeklyTransactions
            .filter((obj) => obj.prevWallet !== obj.updatedWallet)
            .forEach((obj) => {
              spndedWeekly +=
                parseFloat(obj.prevWallet) - parseFloat(obj.updatedWallet);
            });
        }
      }
      if (
        gameMode === "goldCoin" &&
        spndedWeekly + sitInAmount > user.weeklyGoldCoinSpendingLimit
      ) {
        return {
          success: false,
          message:
            "Your weekly spending limit for goldcoins has been exhausted",
        };
      } else if (
        gameMode === "token" &&
        spndedWeekly + sitInAmount > user.weeklyTokenSpendingLimit
      ) {
        return {
          success: false,
          message: "Your weekly spending limit for tokens has been exhausted",
        };
      }
    } else {
      if (
        gameMode === "goldCoin" &&
        sitInAmount > user.weeklyGoldCoinSpendingLimit
      ) {
        return {
          success: false,
          message: "Your sitin amount is exceeding your weekly spending limit",
        };
      } else if (
        gameMode === "token" &&
        sitInAmount > user.weeklyTokenSpendingLimit
      ) {
        return {
          success: false,
          message: "Your sitin amount is exceeding your weekly spending limit",
        };
      }
    }

    crrDate = new Date();
    crrDate.setDate(1);
    crrDate.setHours(0);
    crrDate.setMinutes(0);
    crrDate.setMilliseconds(0);

    let monthStartDate = crrDate.toDateString();

    const monthlyTransactions = await transactionModel.find({
      $and: [
        { userId: userId },
        { createdAt: { $gte: monthStartDate } },
        { amount: { $lt: 0 } },
      ],
    });

    if (monthlyTransactions.length) {
      let spndedMonthly = 0;
      if (monthlyTransactions.length === 1) {
        spndedMonthly =
          gameMode === "goldCoin"
            ? monthlyTransactions[0].prevGoldCoin -
              monthlyTransactions[0].updatedGoldCoin
            : monthlyTransactions[0].prevWallet -
              monthlyTransactions[0].updatedWallet;
      } else {
        if (gameMode === "goldCoin") {
          monthlyTransactions
            .filter((obj) => obj.updatedGoldCoin !== obj.prevGoldCoin)
            .forEach((obj) => {
              spndedMonthly +=
                parseFloat(obj.prevGoldCoin) - parseFloat(obj.updatedGoldCoin);
            });
        } else {
          spndedMonthly = monthlyTransactions
            .filter((obj) => obj.prevWallet !== obj.updatedWallet)
            .forEach((obj) => {
              spndedMonthly +=
                parseFloat(obj.prevWallet) - parseFloat(obj.updatedWallet);
            });
        }
      }

      console.log(
        "spndedMonthly =====>",
        spndedMonthly + sitInAmount,
        user.monthlyGoldCoinSpendingLimit
      );
      if (
        gameMode === "goldCoin" &&
        spndedMonthly + sitInAmount >= user.monthlyGoldCoinSpendingLimit
      ) {
        return {
          success: false,
          message:
            "Your monthly spending limit for goldcoins has been exhausted",
        };
      } else if (
        gameMode === "token" &&
        spndedMonthly + sitInAmount > user.monthlyTokenSpendingLimit
      ) {
        return {
          success: false,
          message: "Your weekly spending limit for tokens has been exhausted",
        };
      }
    } else {
      if (
        gameMode === "goldCoin" &&
        sitInAmount > user.monthlyGoldCoinSpendingLimit
      ) {
        return {
          success: false,
          message: "Your sitin amount is exceeding your weekly spending limit",
        };
      } else if (
        gameMode === "token" &&
        sitInAmount > user.monthlyTokenSpendingLimit
      ) {
        return {
          success: false,
          message: "Your sitin amount is exceeding your weekly spending limit",
        };
      }
    }

    return {
      success: true,
    };
  } catch (error) {
    console.log("error in checklimits ===>", error);
    return {
      success: true,
    };
  }
};

function getLastSunday() {
  var dt = new Date();
  dt.setDate(dt.getDate() - dt.getDay());
  dt.setHours(0);
  dt.setMinutes(0);
  dt.setMilliseconds(0);
  return dt;
}

export const updateChat = async (io, socket, data) => {
  try {
    console.log("data ==>", data);
    const { tableId, message, userId } = data;
    let room = await roomModel.find({ _id: tableId });
    console.log(room);
    if (room) {
      const user = await userModel.findOne({ _id: userId });

      const { firstName, lastName, profile } = user || {};
      await roomModel.findOneAndUpdate(
        { _id: tableId },
        {
          $push: {
            chats: {
              message: message,
              userId: userId,
              firstName: firstName,
              lastName: lastName,
              profile,
              date: new Date().toLocaleTimeString(),
              seenBy: [],
            },
          },
        }
      );
      let room = await roomModel.findOne({ _id: tableId });

      io.in(tableId).emit("updateChat", { chat: room?.chats });
    } else {
      io.in(tableId).emit("updateChat", { chat: [] });
    }
  } catch (error) {
    console.log("Error in updateChat", error);
  }
};

export const updateSeenBy = async (io, socket, data) => {
  try {
    console.log("update seen by executed", data);
    const { userId, tableId } = data;
    let room = await roomModel.findOne({ _id: tableId });
    console.log("room", room);
    let filterdChats = room.chats.map((chat) => {
      if (chat.userId !== userId && chat.seenBy.indexOf(userId) < 0) {
        chat.seenBy.push(userId);
      }
      return chat;
    });
    // console.log(filterdChats);
    await roomModel.updateOne(
      { _id: tableId },
      { $set: { chats: filterdChats } }
    );
  } catch (error) {
    console.log("error in updateChatIsRead", error);
  }
};

export const typingonChat = async (io, socket, data) => {
  try {
    const { userId, tableId, typing } = data;
    const findUser = await userModel
      .findOne({ _id: userId }, { username: 1 })
      .lean();
    io.typingPlayers[userId] = {
      typing,
      userName: findUser?.username,
      roomId: tableId,
    };
    io.in(tableId).emit("updateTypingState", {
      CrrUserId: userId,
      typing,
      userName: findUser?.username,
      typingUser: io.typingPlayers,
    });
  } catch (error) {
    console.log("error in typingonChat", error);
  }
};
