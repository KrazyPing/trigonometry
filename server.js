const path = require("path");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const Redis = require("ioredis");

const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = "thierrygotabigbutt";

const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;
const DB_FILE = path.join(__dirname, "leaderboard.json");
let localLeaderboard = {};
let globalQuestionsCount = 0;

if (!redis && fs.existsSync(DB_FILE)) {
  try { localLeaderboard = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch (e) { localLeaderboard = {}; }
}

async function recordAnsweredQuestions(name, count = 1) {
  const cleanName = String(name || "Player").trim().slice(0, 16) || "Player";
  
  if (redis) {
    await redis.zincrby("trig_leaderboard", count, cleanName);
    globalQuestionsCount = await redis.incrby("global_questions_count", count);
  } else {
    const key = cleanName.toLowerCase();
    if (!localLeaderboard[key]) localLeaderboard[key] = { name: cleanName, questionsAnswered: 0 };
    localLeaderboard[key].questionsAnswered += count;
    globalQuestionsCount += count;
    try { fs.writeFileSync(DB_FILE, JSON.stringify(localLeaderboard, null, 2)); } catch(e){}
  }
  return await getTopLeaderboard();
}

async function getGlobalCount() {
  if (redis) {
    const val = await redis.get("global_questions_count");
    return parseInt(val || "0", 10);
  }
  return globalQuestionsCount;
}

async function removePlayerFromLeaderboard(name) {
  const cleanName = String(name || "").trim();
  if (redis) {
    const removed = await redis.zrem("trig_leaderboard", cleanName);
    return removed > 0;
  } else {
    const key = cleanName.toLowerCase();
    if (localLeaderboard[key]) {
      delete localLeaderboard[key];
      try { fs.writeFileSync(DB_FILE, JSON.stringify(localLeaderboard, null, 2)); } catch(e){}
      return true;
    }
    return false;
  }
}

async function getTopLeaderboard(limit = 50) {
  if (redis) {
    const raw = await redis.zrevrange("trig_leaderboard", 0, limit - 1, "WITHSCORES");
    const list = [];
    for (let i = 0; i < raw.length; i += 2) {
      list.push({ name: raw[i], questionsAnswered: parseInt(raw[i + 1], 10) });
    }
    return list;
  } else {
    return Object.values(localLeaderboard)
      .sort((a, b) => b.questionsAnswered - a.questionsAnswered)
      .slice(0, limit);
  }
}

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

app.get("/api/leaderboard", async (_req, res) => {
  res.json(await getTopLeaderboard(50));
});

app.get("/api/global-stats", async (_req, res) => {
  res.json({ totalQuestions: await getGlobalCount() });
});

app.post("/api/record-questions", async (req, res) => {
  const { name, count } = req.body;
  if (!name || typeof count !== "number" || count <= 0) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  const updated = await recordAnsweredQuestions(name, count);
  io.emit("globalLeaderboardUpdate", updated);
  io.emit("globalCountUpdate", { totalQuestions: await getGlobalCount() });
  res.json({ success: true });
});

app.post("/api/admin/login", (req, res) => {
  const key = String(req.body?.key || "").trim();
  if (key === ADMIN_KEY) return res.json({ success: true });
  res.status(401).json({ error: "Invalid admin key" });
});

app.delete("/api/admin/leaderboard/:username", async (req, res) => {
  const reqKey = String(req.headers["x-admin-key"] || "").trim();
  if (reqKey !== ADMIN_KEY) return res.status(403).json({ error: "Unauthorized" });

  const { username } = req.params;
  const removed = await removePlayerFromLeaderboard(username);

  if (removed) {
    const updated = await getTopLeaderboard(50);
    io.emit("globalLeaderboardUpdate", updated);
    return res.json({ success: true, leaderboard: updated });
  }
  
  res.status(404).json({ error: "Player not found" });
});

app.get("/{*splat}", (_req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: "*" } });
const lobbies = new Map();

const QUESTIONS = {
  sin:{"0":["0","+"],"π/6":["1/2","+"],"π/4":["√2/2","+"],"π/3":["√3/2","+"],"π/2":["1","+"],"2π/3":["√3/2","+"],"3π/4":["√2/2","+"],"5π/6":["1/2","+"],"π":["0","+"],"7π/6":["1/2","-"],"5π/4":["√2/2","-"],"4π/3":["√3/2","-"],"3π/2":["1","-"],"5π/3":["√3/2","-"],"7π/4":["√2/2","-"],"11π/6":["1/2","-"],"2π":["0","+"]},
  cos:{"0":["1","+"],"π/6":["√3/2","+"],"π/4":["√2/2","+"],"π/3":["1/2","+"],"π/2":["0","+"],"2π/3":["1/2","-"],"3π/4":["√2/2","-"],"5π/6":["√3/2","-"],"π":["1","-"],"7π/6":["√3/2","-"],"5π/4":["√2/2","-"],"4π/3":["1/2","-"],"3π/2":["0","+"],"5π/3":["1/2","+"],"7π/4":["√2/2","+"],"11π/6":["√3/2","+"],"2π":["1","+"]},
  tan:{"0":["0","+"],"π/6":["√3/3","+"],"π/4":["1","+"],"π/3":["√3","+"],"π":["0","+"],"2π/3":["√3","-"],"3π/4":["1","-"],"5π/6":["√3/3","-"],"7π/6":["√3/3","+"],"5π/4":["1","+"],"4π/3":["√3","+"],"3π/2":["undefined","+"],"5π/3":["√3","-"],"7π/4":["1","-"],"11π/6":["√3/3","-"],"2π":["0","+"]},
  sec:{"0":["1","+"],"π/3":["2","+"],"2π/3":["2","-"],"π":["1","-"],"4π/3":["2","-"],"5π/3":["2","+"],"2π":["1","+"],"π/2":["undefined","+"],"3π/2":["undefined","+"]},
  csc:{"π/6":["2","+"],"π/2":["1","+"],"5π/6":["2","+"],"7π/6":["2","-"],"3π/2":["1","-"],"11π/6":["2","-"],"0":["undefined","+"],"π":["undefined","+"]},
  cot:{"π/6":["√3","+"],"π/4":["1","+"],"π/3":["√3/3","+"],"2π/3":["√3/3","-"],"3π/4":["1","-"],"5π/6":["√3","-"],"7π/6":["√3","+"],"5π/4":["1","+"],"4π/3":["√3/3","+"],"7π/4":["1","-"],"11π/6":["√3","-"],"0":["undefined","+"],"π":["undefined","+"]}
};
const ANGLES = {
  easy:["0","π/6","π/4","π/3","π/2"],
  medium:["0","π/6","π/4","π/3","π/2","2π/3","3π/4","5π/6","π","7π/6","5π/4","4π/3"],
  hard:["0","π/6","π/4","π/3","π/2","2π/3","3π/4","5π/6","π","7π/6","5π/4","4π/3","3π/2","5π/3","7π/4","11π/6","2π"]
};

const id = () => crypto.randomBytes(6).toString("hex");
function lobbyCode(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c;
  do { c=""; for(let i=0;i<5;i++) c += chars[Math.floor(Math.random()*chars.length)]; }
  while(lobbies.has(c));
  return c;
}
function safeName(n){ return String(n||"Player").trim().slice(0,16) || "Player"; }
function totalQuestions(mode){ return mode==="ten"?10:mode==="fifty"?50:mode==="classic"?20:Infinity; }
function listPlayers(lobby){
  return [...lobby.players.values()].map(p=>({id:p.id,name:p.name,score:p.score,streak:p.streak,bestStreak:p.bestStreak,host:p.host,ready:p.ready}));
}
function validSettings(s){
  return s && Array.isArray(s.trigs) && s.trigs.length &&
    s.trigs.every(t=>QUESTIONS[t]) && ANGLES[s.difficulty] &&
    ["both","positive","negative"].includes(s.negativeMode) &&
    ["classic","ten","fifty","endless","practice"].includes(s.gameMode) &&
    Number(s.timeLimit)>=0.5;
}
function broadcastLobby(lobby,event,data={}){
  lobby.io.in(lobby.code).emit(event,{...data,code:lobby.code,players:listPlayers(lobby)});
}
function broadcastLeaderboard(lobby){
  const leaderboard=listPlayers(lobby)
    .sort((a,b)=>(b.score-a.score)||(b.bestStreak-a.bestStreak)||a.name.localeCompare(b.name))
    .map((p,i)=>({...p,rank:i+1}));
  lobby.io.in(lobby.code).emit("leaderboard",{leaderboard});
}
function generateQuestion(lobby){
  const s=lobby.settings, possible=[];
  for(const trig of s.trigs) for(const angle of ANGLES[s.difficulty]){
    const d=QUESTIONS[trig][angle];
    if(!d) continue;
    if(s.negativeMode==="positive" && d[1]==="-") continue;
    if(s.negativeMode==="negative" && d[1]==="+") continue;
    possible.push({trig,angle,value:d[0],sign:d[1]});
  }
  return possible.length ? possible[Math.floor(Math.random()*possible.length)] : null;
}
function startQuestion(lobby){
  if(!lobby.gameStarted) return;
  if(lobby.total!==Infinity && lobby.questionIndex>=lobby.total) return finishGame(lobby);
  const q=generateQuestion(lobby);
  if(!q) return finishGame(lobby);
  lobby.questionIndex++;
  const practice=lobby.settings.gameMode==="practice";
  const limit=Math.max(.5,Number(lobby.settings.timeLimit)||2);
  const deadline=practice?0:Date.now()+limit*1000;
  lobby.question={...q,questionIndex:lobby.questionIndex,startedAt:Date.now(),deadline,answers:new Set()};
  broadcastLobby(lobby,"question",{questionIndex:lobby.questionIndex,totalQuestions:lobby.total===Infinity?null:lobby.total,trig:q.trig,angle:q.angle,deadline,timeLimit:limit});
  broadcastLeaderboard(lobby);
  if(!practice) lobby.timer=setTimeout(()=>expireQuestion(lobby,lobby.questionIndex),limit*1000+50);
}
function expireQuestion(lobby,index){
  if(!lobby.gameStarted || !lobby.question || lobby.question.questionIndex!==index) return;
  broadcastLobby(lobby,"questionExpired",{questionIndex:index,correctAnswer:`${lobby.question.sign}${lobby.question.value}`});
  broadcastLeaderboard(lobby);
  lobby.timer=setTimeout(()=>startQuestion(lobby),650);
}
async function processAnswer(lobby,p,msg){
  if(!lobby.gameStarted || !lobby.question || msg.questionIndex!==lobby.question.questionIndex) return;
  if(lobby.question.answers.has(p.id)) return;
  if(lobby.question.deadline && Date.now()>lobby.question.deadline) return;
  lobby.question.answers.add(p.id);
  
  const responseTime=(Date.now()-lobby.question.startedAt)/1000;
  const correct=msg.answer===lobby.question.value && msg.sign===lobby.question.sign;
  let points=0;
  if(correct){
    const updatedGlobal = await recordAnsweredQuestions(p.name, 1);
    io.emit("globalLeaderboardUpdate", updatedGlobal);
    io.emit("globalCountUpdate", { totalQuestions: await getGlobalCount() });
    p.streak++; p.bestStreak=Math.max(p.bestStreak,p.streak); points=100;
    if(lobby.settings.gameMode!=="practice"){
      const limit=Number(lobby.settings.timeLimit)||2;
      if(responseTime<limit*.25) points+=50;
      else if(responseTime<limit*.5) points+=25;
    }
    points+=p.streak*5; p.score+=points;
  } else p.streak=0;

  broadcastLobby(lobby,"answerResult",{playerId:p.id,correct,points,score:p.score,streak:p.streak,bestStreak:p.bestStreak,responseTime:Number(responseTime.toFixed(3)),correctAnswer:`${lobby.question.sign}${lobby.question.value}`});
  broadcastLeaderboard(lobby);
  if(lobby.question.answers.size===lobby.players.size){
    clearTimeout(lobby.timer);
    lobby.timer=setTimeout(()=>startQuestion(lobby),500);
  }
}
function finishGame(lobby){
  lobby.gameStarted=false; clearTimeout(lobby.timer); lobby.question=null;
  const rankings=listPlayers(lobby).sort((a,b)=>b.score-a.score || b.bestStreak-a.bestStreak);
  broadcastLobby(lobby,"gameOver",{rankings});
}
function disconnectPlayer(socket){
  const lobby=socket.data.lobby, pid=socket.data.playerId;
  if(!lobby || !pid) return;
  const p=lobby.players.get(pid);
  if(!p) return;
  lobby.players.delete(pid);
  socket.leave(lobby.code);
  if(lobby.players.size===0){ clearTimeout(lobby.timer); lobbies.delete(lobby.code); return; }
  if(p.host){
    const next=lobby.players.values().next().value;
    next.host=true; lobby.hostId=next.id;
    broadcastLobby(lobby,"hostChanged",{hostId:lobby.hostId});
  } else {
    broadcastLobby(lobby,"left");
  }
}

io.on("connection", async socket=>{
  socket.emit("globalLeaderboardUpdate", await getTopLeaderboard());
  socket.emit("globalCountUpdate", { totalQuestions: await getGlobalCount() });

  socket.on("createLobby",({name,settings}={})=>{
    if(!validSettings(settings)) return socket.emit("error",{message:"Invalid multiplayer settings."});
    const code=lobbyCode(), pid=id();
    const lobby={code,io,hostId:pid,settings,players:new Map(),gameStarted:false,questionIndex:0,total:totalQuestions(settings.gameMode),question:null,timer:null};
    lobby.players.set(pid,{id:pid,name:safeName(name),host:true,ready:true,score:0,streak:0,bestStreak:0});
    lobbies.set(code,lobby);
    socket.data.lobby=lobby; socket.data.playerId=pid; socket.join(code);
    socket.emit("lobbyCreated",{playerId:pid,code,host:true,settings,players:listPlayers(lobby)});
  });

  socket.on("joinLobby",({code,name}={})=>{
    const lobby=lobbies.get(String(code||"").toUpperCase());
    if(!lobby) return socket.emit("error",{message:"Lobby not found. Check the code."});
    if(lobby.gameStarted) return socket.emit("error",{message:"That game has already started."});
    if(lobby.players.size>=20) return socket.emit("error",{message:"That lobby is full."});
    const pid=id();
    lobby.players.set(pid,{id:pid,name:safeName(name),host:false,ready:false,score:0,streak:0,bestStreak:0});
    socket.data.lobby=lobby; socket.data.playerId=pid; socket.join(lobby.code);
    socket.emit("connected",{playerId:pid,code:lobby.code,host:false,settings:lobby.settings,players:listPlayers(lobby)});
    broadcastLobby(lobby,"lobbyUpdate",{settings:lobby.settings});
  });

  socket.on("gameMessage",msg=>{
    const lobby=socket.data.lobby;
    const p=lobby && lobby.players.get(socket.data.playerId);
    if(!lobby || !p) return;
    
    if(msg.type==="toggleReady"){
      p.ready = !p.ready;
      broadcastLobby(lobby,"lobbyUpdate",{settings:lobby.settings});
    } else if(msg.type==="emote"){
      broadcastLobby(lobby,"playerEmote",{playerId:p.id,emoji:msg.emoji});
    } else if(msg.type==="start"){
      if(!p.host) return socket.emit("error",{message:"Only the host can start the game."});
      if(lobby.gameStarted) return socket.emit("error",{message:"The game is already running."});
      if(!validSettings(msg.settings)) return socket.emit("error",{message:"Invalid game settings. Refresh the page and try again."});
      lobby.settings=msg.settings;
      lobby.total=totalQuestions(msg.settings.gameMode);
      lobby.gameStarted=true;
      lobby.questionIndex=0;
      for(const x of lobby.players.values()){x.score=0;x.streak=0;x.bestStreak=0;}
      const startPayload={settings:lobby.settings,totalQuestions:lobby.total===Infinity?null:lobby.total};
      lobby.io.in(lobby.code).emit("gameStart",startPayload);
      broadcastLeaderboard(lobby);
      socket.emit("startAccepted",{code:lobby.code});
      setTimeout(()=>startQuestion(lobby),3500); // 3-second countdown buffer
    } else if(msg.type==="answer") {
      processAnswer(lobby,p,msg);
    } else if(msg.type==="leave") {
      socket.disconnect(true);
    }
  });
  socket.on("disconnect",()=>disconnectPlayer(socket));
});

httpServer.listen(PORT,"0.0.0.0",()=>console.log(`Trig Speed Challenge running on port ${PORT}`));
