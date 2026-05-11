import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Crown, Gamepad2, UserRound } from "lucide-react";
import { createRoom, fetchLeaderboard, fetchProfile, fetchRooms, joinRoom } from "./api";
import { GameScreen } from "./components/GameScreen";
import { LeaderboardScreen } from "./components/LeaderboardScreen";
import { LobbyScreen } from "./components/LobbyScreen";
import { ProfileScreen } from "./components/ProfileScreen";
import { socket } from "./socket";
import { usePlayerIdentity } from "./usePlayerIdentity";
function App() {
    const identity = usePlayerIdentity();
    const [tab, setTab] = useState("games");
    const [rooms, setRooms] = useState([]);
    const [activeRoom, setActiveRoom] = useState(null);
    const [game, setGame] = useState(null);
    const [leaderboard, setLeaderboard] = useState([]);
    const [profile, setProfile] = useState(null);
    const [entryFee, setEntryFee] = useState(1000);
    const [maxPlayers, setMaxPlayers] = useState(4);
    const [message, setMessage] = useState("");
    const send = useCallback((event, payload = {}) => {
        if (!activeRoom)
            return;
        socket.emit(event, {
            roomCode: activeRoom.code,
            playerId: identity.playerId,
            ...payload
        });
    }, [activeRoom, identity.playerId]);
    const refreshStatic = useCallback(async () => {
        const [roomsData, leaderboardData, profileData] = await Promise.all([
            fetchRooms(),
            fetchLeaderboard(),
            fetchProfile(identity.playerId).catch(() => null)
        ]);
        setRooms(roomsData);
        setLeaderboard(leaderboardData);
        setProfile(profileData);
    }, [identity.playerId]);
    useEffect(() => {
        void refreshStatic();
        const timer = setInterval(() => void refreshStatic(), 5000);
        return () => clearInterval(timer);
    }, [refreshStatic]);
    useEffect(() => {
        const updateHandler = (payload) => {
            if (payload.room) {
                setActiveRoom(payload.room);
            }
            setGame(payload.game);
            if (payload.game?.lastCard) {
                // modal visibility is handled in GameScreen, store update is enough
            }
        };
        const errorHandler = (payload) => {
            setMessage(payload.message);
            setTimeout(() => setMessage(""), 2800);
        };
        socket.on("game:update", updateHandler);
        socket.on("game:error", errorHandler);
        return () => {
            socket.off("game:update", updateHandler);
            socket.off("game:error", errorHandler);
        };
    }, []);
    const handleCreateRoom = async () => {
        try {
            const room = await createRoom({
                entryFee,
                maxPlayers,
                playerId: identity.playerId,
                playerName: identity.playerName,
                avatarUrl: identity.avatarUrl
            });
            setActiveRoom(room);
            socket.emit("room:join", {
                roomCode: room.code,
                playerId: identity.playerId,
                playerName: identity.playerName,
                avatarUrl: identity.avatarUrl
            });
            setMessage(`Комната ${room.code} создана.`);
            await refreshStatic();
        }
        catch (error) {
            setMessage(error.message);
        }
    };
    const handleJoinRoom = async (code) => {
        try {
            const room = await joinRoom({
                code,
                playerId: identity.playerId,
                playerName: identity.playerName,
                avatarUrl: identity.avatarUrl
            });
            setActiveRoom(room);
            socket.emit("room:join", {
                roomCode: room.code,
                playerId: identity.playerId,
                playerName: identity.playerName,
                avatarUrl: identity.avatarUrl
            });
            setMessage(`Вы вошли в ${room.code}.`);
            await refreshStatic();
        }
        catch (error) {
            setMessage(error.message);
        }
    };
    const handleStartRoom = async () => {
        if (!activeRoom)
            return;
        try {
            socket.emit("game:start", { roomCode: activeRoom.code, playerId: identity.playerId });
        }
        catch (error) {
            setMessage(error.message);
        }
    };
    const showGame = useMemo(() => tab === "games" && !!game && game.status !== "lobby", [tab, game]);
    return (_jsxs("div", { className: "mx-auto min-h-screen w-full max-w-[1240px] px-3 pb-24 pt-4 text-white", children: [tab === "games" && (_jsxs(_Fragment, { children: [!showGame && (_jsx(LobbyScreen, { playerName: identity.playerName, balance: profile?.balance ?? 0, rooms: rooms, activeRoom: activeRoom, entryFee: entryFee, maxPlayers: maxPlayers, setEntryFee: setEntryFee, setMaxPlayers: setMaxPlayers, onCreateRoom: handleCreateRoom, onJoinRoom: handleJoinRoom, onStartRoom: handleStartRoom })), showGame && game && _jsx(GameScreen, { game: game, meId: identity.playerId, send: send })] })), tab === "leaderboard" && _jsx(LeaderboardScreen, { entries: leaderboard }), tab === "profile" && _jsx(ProfileScreen, { profile: profile }), message && (_jsx("div", { className: "fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-xl border border-gold/40 bg-panel px-4 py-2 text-sm text-gold shadow-premium", children: message })), _jsx("nav", { className: "fixed bottom-3 left-1/2 z-30 w-[min(92vw,560px)] -translate-x-1/2 rounded-2xl border border-borderSoft bg-panel/95 p-1.5 shadow-premium", children: _jsxs("div", { className: "grid grid-cols-3 gap-1", children: [_jsx(BottomButton, { label: "\u0418\u0433\u0440\u044B", icon: _jsx(Gamepad2, { className: "h-4 w-4" }), active: tab === "games", onClick: () => setTab("games") }), _jsx(BottomButton, { label: "\u041B\u0438\u0434\u0435\u0440\u0431\u043E\u0440\u0434", icon: _jsx(Crown, { className: "h-4 w-4" }), active: tab === "leaderboard", onClick: () => setTab("leaderboard") }), _jsx(BottomButton, { label: "\u041F\u0440\u043E\u0444\u0438\u043B\u044C", icon: _jsx(UserRound, { className: "h-4 w-4" }), active: tab === "profile", onClick: () => setTab("profile") })] }) })] }));
}
function BottomButton({ label, icon, active, onClick }) {
    return (_jsxs("button", { className: `inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm ${active ? "bg-gradient-to-r from-green to-gold text-black" : "bg-panel text-emerald-100"}`, onClick: onClick, children: [icon, label] }));
}
export default App;
