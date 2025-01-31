import express from "express";
import { createServer } from "http";
import dotenv from "dotenv";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";
import cookieParser from "cookie-parser";

import socketConnection from "./socketConnection/index.js";
import mongoConnect from "./config/dbConnection.js";
import roomModel from "./modals/roomModal.js";
import { leaveApiCall } from "./Functions/game.js"; //checkLimits,
import { changeAdmin, getUserId } from "./firestore/dbFetch.js";
import mongoose from "mongoose";
import User from "./landing-server/models/user.model.js";
import auth from "./landing-server/middlewares/auth.js";
import jwtStrategy from "./landing-server/config/jwtstragety.js";
import passport from "passport";
import Token from "./landing-server/models/Token.model.js";
import Message from "./modals/messageModal.js";
import Notification from "./modals/NotificationModal.js";
import { log } from "console";
import logger from "./config/logger.js";
import socketsAuthentication from "./landing-server/middlewares/socketsMiddleware.js";
import Basicauth from "./landing-server/middlewares/basicAuth.js";

const convertMongoId = (id) => mongoose.Types.ObjectId(id);

dotenv.config();
const app = express();
mongoConnect();
const whitelist = [
  "https://beta.las-vegas.com",
  "https://las-vegas.com",
  "http://localhost:3000",
  "https://blackjack.scrooge.casino",
];
const corsOptions = {
  origin: function (origin, callback) {
    if (whitelist.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
};

app.use(express.json());
app.use(cookieParser());

app.use(
  express.urlencoded({
    extended: false,
  })
);

app.use(
  cors({
    origin: [
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3004",
      "https://scrooge.casino",
      "https://poker.scrooge.casino",
      "https://blackjack.scrooge.casino",
      "https://slot.scrooge.casino",
      "https://admin.scrooge.casino",
      "https://market.scrooge.casino",
      "https://roulette.scrooge.casino",
      "https://dev.scrooge.casino",
      "https://devpoker.scrooge.casino",
      "https://devslot.scrooge.casino",
      "https://devblackjack.scrooge.casino",
      "https://devadmin.scrooge.casino",
      "https://devmarket.scrooge.casino",
      "https://devroulette.scrooge.casino",

      "https://beta.scrooge.casino",
      "https://betapoker.scrooge.casino",
      "https://betaslot.scrooge.casino",
      "https://betablackjack.scrooge.casino",
      "https://betaadmin.scrooge.casino",
      "https://betamarket.scrooge.casino",
      "https://betaroulette.scrooge.casino",
    ],
    credentials: true,
  })
);
const server = createServer(app);
// set security HTTP headers
app.use(
  helmet({
    frameguard: {
      action: "sameorigin",
    },
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  })
);
const io = new Server(server, {});

io.use((socket, next) => {
  // Middleware logic here
  // You can access socket.request and socket.handshake to inspect the request and handshake data.
  socketsAuthentication(socket.handshake).then(resp=>{
    socket.user = {
      userId: resp.userId, 
    }
    return next();
  }).catch(err=>{
    next(new Error('Authentication failed'));
    return;
  });
});

socketConnection(io);
app.use((req, _, next) => {
  logger.info(`HEADERS ${req.headers} `);
  next();
});

passport.use("jwt", jwtStrategy);

app.get("/", (req, res) => {
  res.send("<h1>Blackjack Server is running</h1>");
});

app.get("/checkTableExist/:tableId", async (req, res) => {
  try {
    const { tableId } = req.params;
    const room = await roomModel.findOne({ tableId });
    if (room) {
      res.status(200).send({
        success: true,
        error: "no-error",
      });
    } else {
      res.status(404).send({
        success: false,
        error: "Table not found",
      });
    }
  } catch (error) {
    console.log("Error in Blackjack game server =>", error);
    res.status(500).send({
      success: false,
      error: "Internal server error",
    });
  }
});

app.get("/getuserid/:token", async (req, res) => {
  const { token } = req.params;
  const uid = await getUserId(token);
  res.send({ code: 200, uid });
});

app.get("/rescueTable/:tableId", async (req, res) => {
  try {
    const { tableId } = req.params;
    const room = await roomModel.findOne({ tableId });
    if (room) {
      let firstGameTime = new Date(room.firstGameTime);
      let now = new Date();
      if ((now - firstGameTime) / (1000 * 60) > 15) {
        let player = room.players;
        let allUsers = player.concat(room.watchers);
        let users = [];
        allUsers.forEach((item) => {
          let uid = item.id;
          users.push({
            uid,
            hands: item.hands,
            coinsBeforeJoin: item.coinsBeforeStart,
            gameLeaveAt: new Date(),
            gameJoinedAt: item.gameJoinedAt,
            isWatcher: room.watchers.find((ele) => ele.id === uid)
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
        res.status(200).send({
          stuckTable: payload,
          success: true,
          error: "no-error",
        });
      } else {
        res.status(404).send({
          success: false,
          error: "Table exist and its running in game",
        });
      }
    } else {
      res.status(404).send({
        success: false,
        error: "Table not Found",
      });
    }
  } catch (error) {
    console.log("Error in rescueTable api", error);
    res.status(500).send({
      success: false,
      error: "Internal server error",
    });
  }
});

app.get("/deleteStuckTable/:tableId", async (req, res) => {
  try {
    const { tableId } = req.params;
    const room = await roomModel.deleteOne({ tableId });
    let copy = { ...io.typingUser };
    if (copy) {
      for (let key in copy) {
        if (copy[key][tableId]) {
          delete copy[key];
        }
      }
      io.typingUser = copy;
    }
    if (room) {
      res.status(200).send({
        success: true,
        error: "no-error",
      });
    } else {
      res.status(404).send({
        success: false,
        error: "Table not found",
      });
    }
  } catch (error) {
    console.log("Error in Blackjack game delete table api =>", error);
  }
});

app.get("/leaveGame/:tableId/:userId", async (req, res) => {
  try {
    const { tableId, userId } = req.params;
    let roomdata = await roomModel
      .findOne({
        $and: [
          { tableId },
          { players: { $elemMatch: { id: convertMongoId(userId) } } },
        ],
      })
      .lean();
    if (roomdata && roomdata.players?.length <= 1) {
      const ress = await leaveApiCall(roomdata, userId);
      if (ress) {
        const noOfRooms = await roomModel.countDocuments({
          public: true,
          finish: false,
          gameMode: roomdata.gameMode,
        });

        console.log("no of rooms ===> 196", noOfRooms);

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
        return res.send({
          success: true,
        });
      }
    } else if (roomdata && roomdata.players.length > 1) {
      let newAdmin = roomdata.players.find(
        (el) => el.id.toString() !== userId.toString()
      );
      let leaveUser = roomdata.players.find(
        (el) => el.id.toString() === userId.toString()
      );
      let leaveReq = [...roomdata.leaveReq];
      leaveReq.push(leaveUser.id);
      if (roomdata.hostId === userId)
        await changeAdmin(newAdmin.id, tableId, roomdata.gameType);
      const ress = await leaveApiCall(
        {
          ...roomdata,
          hostId: roomdata.hostId === userId ? newAdmin.id : roomdata.hostId,
        },
        leaveUser.id
      );
      if (ress) {
        const leave = await roomModel.updateOne(
          {
            tableId,
          },
          {
            hostId: roomdata.hostId === userId ? newAdmin.id : roomdata.hostId,
            leaveReq,
            $pull: {
              players: userId,
            },
          }
        );
        res.send({
          success: true,
        });
      }
    } else {
      let roomdata = await roomModel.findOne({ tableId }).lean();
      if (
        !roomdata?.players?.find((el) => el.id.toString() === userId.toString())
      ) {
        const ress = await leaveApiCall(roomdata, userId);
        if (ress) {
          return res.send({
            success: true,
          });
        }
      }
    }
  } catch (error) {
    console.log("Error in checkUserInGame api", error);
    res.status(500).send({
      success: false,
      error: "Internal server error",
    });
  }
});
app.get("/checkUserInGame/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const room = await roomModel.findOne({
      players: { $elemMatch: { id: userId } },
    });
    if (room && room.players.find((el) => el.id === userId)) {
      res.status(200).send({
        success: false,
        gameStatus: "InGame",
        link: `${req.baseUrl}/blackjack/index.html?tableid=${room.tableId}&gameCollection=${room.gameType}`,
        leaveTableUrl: `https://blackjack-server-t3e66zpola-uc.a.run.app/leaveGame/${room.tableId}/${userId}`,
      });
    } else {
      res.status(200).send({
        success: true,
        gameStatus: "online",
      });
    }
  } catch (error) {
    res.status(500).send({
      success: false,
      error: "Internal server error",
    });
  }
});

app.get("/getUserForInvite/:tableId", Basicauth, async (req, res) => {
  try {
    if (!req.params.tableId) {
      return res.status(400).send({ msg: "Table id not found." });
    }

    const roomData = await roomModel.findOne({
      _id: mongoose.Types.ObjectId(req.params.tableId),
    });

    if (!roomData) {
      return res.status(403).send({ msg: "Table not found." });
    }

    const { leaveReq, invPlayers, players } = roomData;
    const allId = [...leaveReq, ...invPlayers, ...players.map((el) => el.id)];

    const allUsers = await User.find({
      //  _id: { $nin: allId },
      isRegistrationComplete: true,
    }).select({ id: 1, username: 1 });

    return res.status(200).send({ data: allUsers });
  } catch (error) {
    return res.status(500).send({ msg: "Internal server error" });
  }
});

app.get("/getRunningGame", Basicauth, async (req, res) => {
  const blackjackRooms = await roomModel.find({ finish: false });
  res.status(200).send({ rooms: blackjackRooms });
});

app.get("/getAllUsers", Basicauth, async (req, res) => {
  // const { userId } = req.params;
  // if (!userId) {
  //   return res.status(400).send({ message: 'User id is required.' });
  // }
  try {
    const { userId } = req.query;
    // console.log("user ==>", req.user);
    const friendList = await User.find({
      $and: [{ isRegistrationComplete: true }, { _id: { $nin: [userId] } }],
    });

    // {
    //   isRegistrationComplete: true,
    // }

    // .populate({
    //   path: 'friends',
    //   select: {
    //     recipient: 1,
    //     requester: 1,
    //     status: 1,
    //     isBlocked: 1,
    //     isDeleted: 1,
    //   },
    //   populate: {
    //     path: 'recipient',
    //   },
    // });

    res.status(200).send({ allUsers: friendList });
  } catch (error) {
    console.log(error);
    res.status(500).send({ message: "Internal server error." });
  }
});

app.post("/createTable",Basicauth, auth(), async (req, res) => {
  try {
    const {
      gameName,
      public: isPublic,
      gameMode,
      invitedUsers,
      sitInAmount,
    } = req.body;
    const { username, wallet, goldCoin, email, _id, avatar, monthlyClaimBonus } = req.user;
    let valid = true;
    let err = {};
    const mimimumBet = 1;
    if (!gameName) {
      err.gameName = "Game name is required.";
      valid = false;
    }

    if (parseFloat(sitInAmount) < mimimumBet) {
      err.sitInAmount = "Minimum sitting amount is 5.";
      valid = false;
    }
    let newWallet = gameMode === "goldCoin" ? goldCoin : wallet;
    console.log("current", newWallet);
    if (parseFloat(sitInAmount) > newWallet) {
      err.sitInAmount = "Sit in amount cant be more then user wallet amount.";
      valid = false;
    }

    if (parseFloat(sitInAmount) > (newWallet - monthlyClaimBonus) && gameMode !== "goldCoin") {
      err.sitInAmount = "You can only play with One time Wager and Withdrawable amount";
      valid = false;
    }

    if (!newWallet) {
      err.gameName = "You don't have enough balance in your wallet.";
      valid = false;
    }

    // const limit = await checkLimits(
    //   _id,
    //   gameMode,
    //   parseFloat(sitInAmount),
    //   req.user
    // );

    // console.log("limits ===>", limit);

    // if (!limit?.success) {
    //   res.status(403).send({ ...err, message: limit.message });
    //   return;
    // }

    if (!valid) {
      // console.log({err},"gameMode",gameMode);
      return res.status(403).send({ ...err, message: "Invalid data" });
    }

    let query = { "players.id": _id };
    console.log("query", query);
    const checkRoom = await roomModel.findOne(query);
    console.log("checkRoom", checkRoom);

    if (checkRoom) {
      return res.status(403).send({ message: "You are already in game." });
    }

    const invitetedPlayerUserId = invitedUsers.map((el) => el.value);

    const rTimeout = 40;

    const newRoom = await roomModel.create({
      players: [
        {
          name: username,
          wallet: parseFloat(sitInAmount),
          hands: [],
          cards: [],
          coinsBeforeStart: parseFloat(sitInAmount),
          avatar: avatar,
          photoURI: req.user.profile,
          id: _id,
          ticket: req?.user?.ticket,
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
          stats: { countryCode: "IN" },
          gameJoinedAt: new Date(),
          meetingToken: "",
          isSurrender: false,
          isActed: false,
          action: "",
          isInsured: false,
        },
      ],
      remainingPretimer: 3,
      gamestart: false,
      finish: false,
      hostId: _id,
      invPlayers: invitetedPlayerUserId,
      public: isPublic,
      allowWatcher: false,
      media: "no-media",
      timer: rTimeout,
      gameType: "Blackjack_Tables",
      gameName: gameName,
      gameMode: gameMode,
      meetingToken: "",
      meetingId: "",
      dealer: {
        cards: [],
        hasAce: false,
        sum: 0,
      },
      askForInsurance: false,
      actedForInsurace: 0,
    });

    console.log(JSON.stringify(newRoom.players));
    console.log("Usser --> ", req.user);
    if (gameMode === "token") {
      await User.updateOne({ _id }, { wallet: wallet - sitInAmount });
    } else if (gameMode === "goldCoin") {
      await User.updateOne({ _id }, { goldCoin: goldCoin - sitInAmount });
    }
    if (Array.isArray(invitetedPlayerUserId) && invitetedPlayerUserId.length) {
      const sendMessageToInvitedUsers = [
        ...invitetedPlayerUserId.map((el) => {
          return {
            sender: _id,
            receiver: el,
            message: `<a href='${process.env.CLIENTURL}/game?gameCollection=Blackjack_Tables&tableid=${newRoom._id}'>Click here</a> to play blackjack with me.`,
          };
        }),
      ];

      const sendNotificationToInvitedUsers = [
        ...invitetedPlayerUserId.map((el) => {
          return {
            sender: _id,
            receiver: el,
            message: `has invited you to play blackjack.`,
            url: `${process.env.CLIENTURL}/game?gameCollection=Blackjack_Tables&tableid=${newRoom._id}`,
          };
        }),
      ];

      await Message.insertMany(sendMessageToInvitedUsers);
      await Notification.insertMany(sendNotificationToInvitedUsers);
    }

    return res.status(200).send({ roomId: newRoom._id });
  } catch (error) {
    console.log(error);
    return res.status(500).send({ message: "Internal server error." });
  }
});

app.get("/check-auth", Basicauth, auth(), async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    const checkTokenExists = await Token.findOne({ token });

    if (!checkTokenExists) {
      return res.status(403).send({ message: "Token not exists." });
    }

    res.status(200).send({ user: req.user });
  } catch (error) {
    res.status(500).send({ message: "Internal server error" });
  }
});

app.post("/refillWallet", auth(), async (req, res) => {
  try {
    const user = req.user;
    let { tableId, amount, mode } = req.body;
    amount = parseInt(amount);
    const room = await roomModel.findOne({ _id: tableId });
    if (!mode) {
      return res.status(403).send({ msg: "Please select game mode!" });
    }
    if (!tableId || !amount) {
      return res.status(403).send({ msg: "Invalid data" });
    }
    if (amount < 5) {
      return res.status(403).send({ msg: "Minimum amount to enter is 5." });
    }
    if (amount > user?.wallet && mode === "token") {
      return res
        .status(403)
        .send({ msg: "You don't have enough balance in your wallet" });
    }
    if (amount > user?.goldCoin && mode === "goldCoin") {
      return res
        .status(403)
        .send({ msg: "You don't have enough gold Coins in your wallet" });
    }
    if (
      room?.gameMode?.toString()?.toLowerCase() === "goldCoin" &&
      user?.goldCoin < amount
    ) {
      return res.status(403).send({ msg: "You don't have enough gold coin" });
    }
    if (
      room?.gameMode?.toString()?.toLowerCase() === "token" &&
      user?.wallet < amount
    ) {
      return res.status(403).send({ msg: "You don't have enough wallet" });
    }

    let player = room.players.find(
      (el) => el.id.toString() === (user._id || user.id).toString()
    );

    let totalHands = 0;
    player.hands.forEach((el) => {
      if (el.action === "game-lose") {
        totalHands += el.amount;
      }
    });

    if (amount > user.wallet) {
      return res
        .status(403)
        .send({ msg: "You don't have enough balance in your wallet" });
    }

    // const limit = await checkLimits(
    //   user._id || user.id,
    //   room?.gameMode,
    //   parseFloat(amount) + player?.wallet + totalHands,
    //   user
    // );

    // console.log("limits ===>", limit);

    // if (!limit?.success) {
    //   res.status(403).send({ msg: limit.message });
    //   return;
    // }

    await roomModel.updateOne(
      {
        $and: [
          { tableId },
          { players: { $elemMatch: { id: convertMongoId(user.id) } } },
        ],
      },
      {
        $inc: {
          "players.$.wallet": amount,
          "players.$.coinsBeforeStart": amount,
        },
      }
    );

    const roomData = await roomModel.findOne({
      $and: [
        { tableId },
        { players: { $elemMatch: { id: convertMongoId(user.id) } } },
      ],
    });

    if (roomData) {
      io.in(tableId).emit("updateRoom", roomData);
    }

    let refillObj = {};

    if (room?.gameMode.toString().toLowerCase() !== "goldcoin") {
      refillObj = { wallet: -amount };
    } else {
      refillObj = { goldCoin: -amount };
    }

    await User.updateOne({ _id: convertMongoId(user.id) }, { $inc: refillObj });

    res.status(200).send({ msg: "Success" });
  } catch (error) {
    res.status(500).send({ msg: "Internel server error" });
    console.log(error);
  }
});

app.get("/getTablePlayers", async (req, res) => {
  try {
    const roomData = await roomModel.findOne({ tableId: req.params.tableId });

    if (!roomData) {
      return res.status(403).send({ message: "Room not found" });
    }

    res.status(200).send({ players: roomData.players });
  } catch (error) {
    console.log(error);
    res.status(500).send({ message: "Internal server error" });
  }
});

app.post("/changeGameMode", auth(), async (req, res) => {
  try {
    const user = req.user;
    let { gameMode } = req.body;
    //  console.log("gameMode",gameMode);
    await User.updateOne(
      { _id: convertMongoId(user.id) },
      { gameMode: gameMode }
    );
    let getUpdatedData = await User.findOne({ _id: convertMongoId(user.id) });
    res.status(200).send({ code: 200, msg: "Success", user: getUpdatedData });
  } catch (error) {
    res.status(500).send({ msg: "Internel server error" });
    console.log(error);
  }
});

server.listen(process.env.PORT, () =>
  console.log(`Listening on ${process.env.PORT}`)
);
