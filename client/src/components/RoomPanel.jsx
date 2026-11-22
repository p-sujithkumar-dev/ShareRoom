import { useState } from "react";
import { Copy, Check, Plus, LogIn, DoorOpen } from "lucide-react";

export default function RoomPanel({ roomId, roomName, onCreate, onJoin }) {
  const [inputRoomName, setInputRoomName] = useState("");
  const [joinId, setJoinId] = useState("");
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    if (creating) return;

    setCreating(true);

    try {
      await onCreate(inputRoomName.trim() || "My Shared Room");
      setInputRoomName("");
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = () => {
    if (!joinId.trim()) return;

    onJoin(joinId.trim().toUpperCase());
  };

  const copyRoomId = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (error) {
      console.error("Copy failed:", error);
    }
  };

  return (
    <section className="room-panel">
      {!roomId ? (
        <div className="room-options">
          {/* CREATE ROOM */}
          <div className="room-option-card">
            <div className="room-option-icon create-icon">
              <Plus size={23} />
            </div>

            <h2>Create a Room</h2>

            <p>
              Create a private workspace and share files with nearby devices.
            </p>

            <input
              type="text"
              placeholder="Enter room name"
              value={inputRoomName}
              onChange={(e) => setInputRoomName(e.target.value)}
              maxLength={40}
            />

            <button
              className="create-room-btn"
              onClick={handleCreate}
              disabled={creating}
            >
              <Plus size={17} />
              {creating ? "Creating..." : "Create Room"}
            </button>
          </div>

          {/* JOIN ROOM */}
          <div className="room-option-card">
            <div className="room-option-icon join-icon">
              <LogIn size={23} />
            </div>

            <h2>Join a Room</h2>

            <p>Enter the Room ID shared by another device to request access.</p>

            <input
              type="text"
              placeholder="Enter Room ID"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleJoin();
              }}
              maxLength={8}
            />

            <button
              className="join-room-btn"
              onClick={handleJoin}
              disabled={!joinId.trim()}
            >
              <LogIn size={17} />
              Join Room
            </button>
          </div>
        </div>
      ) : (
        /* ACTIVE ROOM */
        <div className="active-room-card">
          <div className="active-room-info">
            <div className="active-room-icon">
              <DoorOpen size={24} />
            </div>

            <div>
              <span className="active-room-label">ACTIVE ROOM</span>

              <h2>You're connected!</h2>

              <p>Share this Room ID with other devices.</p>
            </div>
          </div>

          <div className="room-id-box">
            <div className="room-details">
              <span>ROOM NAME</span>
              <strong className="room-name-text">
                {roomName || "My Shared Room"}
              </strong>
            </div>

            <div className="room-details">
              <span>ROOM ID</span>
              <strong>{roomId}</strong>
            </div>

            <button
              className="copy-room-btn"
              onClick={copyRoomId}
              title="Copy Room ID"
            >
              {copied ? <Check size={19} /> : <Copy size={19} />}
            </button>
          </div>

          <p className="room-share-hint">
            {copied
              ? "Room ID copied successfully!"
              : "Share this code with devices you want to connect."}
          </p>
        </div>
      )}
    </section>
  );
}
