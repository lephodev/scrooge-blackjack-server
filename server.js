import express from "express";
import { createServer } from "http";
import dotenv from "dotenv";
import cors from "cors";
import { Server } from "socket.io";
import socketConnection from "./socketConnection/index.js";
import mongoConnect from "./config/dbConnection.js";
import roomModel from "./modals/roomModal.js";
import { leaveApiCall } from "./Functions/game.js";
import {
  changeAdmin,
  getUserId,
  updateInGameStatus,
} from "./firestore/dbFetch.js";

dotenv.config();
const app = express();
mongoConnect();
const whitelist = [
  "https://beta.las-vegas.com",
  "https://las-vegas.com",
  "http://localhost:3000",
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
app.use(cors());
const server = createServer(app);
const io = new Server(server, {});
socketConnection(io);

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
        $and: [{ tableId }, { players: { $elemMatch: { id: userId } } }],
      })
      .lean();
    if (roomdata && roomdata.players.length <= 1) {
      const ress = await leaveApiCall(roomdata);
      if (ress) {
        await roomModel.deleteOne({
          tableId,
        });
        return res.send({
          success: true,
        });
      }
    } else if (roomdata && roomdata.players.length) {
      let newAdmin = roomdata.players.find((el) => el.id !== userId);
      let leaveUser = roomdata.players.find((el) => el.id === userId);
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
      if (!roomdata?.players?.find((el) => el.id === userId)) {
        updateInGameStatus(userId);
        return res.send({
          success: true,
        });
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
        link: `${req.baseUrl}/blackjack/index.html?tableid=${room.tableId}&gameCollection=${room.gameType}#/`,
        leaveTableUrl: `https://blackjack-server-t3e66zpola-uc.a.run.app/leaveGame/${room.tableId}/${userId}`,
      });
    } else {
      res.status(200).send({
        success: true,
        gameStatus: "online",
      });
    }
  } catch (error) {
    console.log("Error in checkUserInGame api", error);
    res.status(500).send({
      success: false,
      error: "Internal server error",
    });
  }
});
server.listen(process.env.PORT, () =>
  console.log(`Listening on ${process.env.PORT}`)
);
