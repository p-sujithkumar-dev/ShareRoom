import { useEffect, useRef, useState } from "react";

import axios from "axios";

import { io } from "socket.io-client";

import {
  Monitor,
  Laptop,
  Users,
  Files,
  RefreshCw,
  Wifi,
  ShieldCheck,
  CheckCircle,
  XCircle,
  File,
  Check,
  AlertCircle,
} from "lucide-react";

import Header from "./components/Header";

import RoomPanel from "./components/RoomPanel";

import UploadZone from "./components/UploadZone";

import FileList from "./components/FileList";

import { API_URL, SERVER_URL } from "./config";

import "./App.css";

export default function App() {
  const socketRef = useRef(null);
  // DEVICE IDENTITY
  const [deviceId] = useState(() => {
    let savedId = localStorage.getItem("shareroom_deviceId");

    if (!savedId) {
      savedId = `device_${Math.random().toString(36).slice(2, 12)}`;

      localStorage.setItem("shareroom_deviceId", savedId);
    }

    return savedId;
  });

  const [deviceName] = useState(() => {
    let savedName = localStorage.getItem("shareroom_device");

    if (!savedName) {
      savedName = `Device-${Math.random().toString(36).slice(2, 7)}`;

      localStorage.setItem("shareroom_device", savedName);
    }

    return savedName;
  });
  // ROOM STATE
  const [roomId, setRoomId] = useState(
    () => localStorage.getItem("shareroom_roomId") || "",
  );

  const [roomName, setRoomName] = useState("My Shared Room");

  const [joined, setJoined] = useState(false);

  const [connected, setConnected] = useState(false);
  // FILE STATE
  const [files, setFiles] = useState([]);

  const [uploading, setUploading] = useState(false);

  const [progress, setProgress] = useState(0);

  const [uploadItems, setUploadItems] = useState([]);
  // DEVICE STATE
  const [devices, setDevices] = useState([]);

  const [deviceCount, setDeviceCount] = useState(0);

  const [pendingRequests, setPendingRequests] = useState([]);
  // APPROVAL STATE
  const [pendingApproval, setPendingApproval] = useState(false);
  // MESSAGE
  const [message, setMessage] = useState("");
  // AUTO DISMISS MESSAGE
  useEffect(() => {
    if (!message) return;

    const timer = setTimeout(() => {
      setMessage("");
    }, 4000);

    return () => clearTimeout(timer);
  }, [message]);
  // AUTO HIDE UPLOAD DASHBOARD AFTER COMPLETION
  useEffect(() => {
    if (uploading || uploadItems.length === 0) return;

    const timer = setTimeout(() => {
      setUploadItems([]);

      setProgress(0);
    }, 4000);

    return () => clearTimeout(timer);
  }, [uploading, uploadItems]);
  // SOCKET CONNECTION
  useEffect(() => {
    const socket = io(SERVER_URL, {
      reconnection: true,

      reconnectionAttempts: Infinity,

      reconnectionDelay: 1000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Socket Connected:", socket.id);

      setConnected(true);

      const savedRoom = localStorage.getItem("shareroom_roomId");

      if (savedRoom) {
        socket.emit("join-room", {
          roomId: savedRoom,

          deviceId,

          deviceName,
        });
      }
    });

    socket.on("disconnect", () => {
      setConnected(false);

      setJoined(false);

      setDevices([]);

      setDeviceCount(0);
    });
    // ROOM JOINED
    socket.on("room-joined", (data) => {
      const joinedRoom = data.roomId.toUpperCase();

      setRoomId(joinedRoom);

      setRoomName(data.roomName || "My Shared Room");

      setJoined(true);

      setPendingApproval(false);

      setMessage("");

      localStorage.setItem("shareroom_roomId", joinedRoom);
    });
    // ROOM ERROR
    socket.on("room-error", (error) => {
      const errorMessage =
        typeof error === "string"
          ? error
          : error?.message || "Something went wrong";

      setJoined(false);
      setFiles([]);
      setDevices([]);
      setPendingRequests([]);
      setDeviceCount(0);
      setPendingApproval(false);
      setMessage(errorMessage);

      if (
        errorMessage === "Invalid Room ID" ||
        errorMessage === "Room not found."
      ) {
        localStorage.removeItem("shareroom_roomId");
        setRoomId("");
        setRoomName("My Shared Room");
      }
    });
    // DEVICE COUNT
    socket.on("device-count", (count) => {
      setDeviceCount(typeof count === "number" ? count : count?.count || 0);
    });
    // DEVICE LIST
    socket.on("device-list", (deviceList) => {
      setDevices(deviceList);
    });
    // HOST CHANGED
    socket.on("host-changed", ({ hostName }) => {
      setMessage(`${hostName || "Another device"} is now the room host`);
    });
    // DEVICE REMOVED
    socket.on("device-removed", ({ message }) => {
      setJoined(false);

      setFiles([]);

      setDevices([]);

      setDeviceCount(0);

      setPendingRequests([]);

      setPendingApproval(false);

      setMessage(message);
    });
    // APPROVAL PENDING
    socket.on("approval-pending", ({ message }) => {
      setJoined(false);

      setPendingApproval(true);

      setMessage(message);
    });
    // APPROVAL GRANTED
    socket.on("approval-granted", ({ message }) => {
      setPendingApproval(false);

      setMessage(message);
    });
    // APPROVAL REJECTED
    socket.on("approval-rejected", ({ message }) => {
      setJoined(false);

      setPendingApproval(false);

      setMessage(message);
    });
    // HOST APPROVAL REQUEST
    socket.on("device-approval-request", (data) => {
      setPendingRequests(Array.isArray(data?.requests) ? data.requests : []);
    });
    // HOST ACTION ERROR
    socket.on("host-action-error", (error) => {
      setMessage(
        typeof error === "string"
          ? error
          : error?.message || "Host action failed",
      );
    });
    // FILE SHARED
    socket.on("file-shared", (newFile) => {
      setFiles((previous) => {
        const exists = previous.some((file) => file._id === newFile._id);

        if (exists) return previous;

        return [newFile, ...previous];
      });
    });
    // FILE DELETED - REAL TIME UPDATE
    socket.on("file-deleted", ({ fileId }) => {
      setFiles((previous) => previous.filter((file) => file._id !== fileId));

      console.log("File deleted:", fileId);
    });

    return () => {
      socket.disconnect();

      socketRef.current = null;
    };
  }, [deviceId, deviceName]);
  // LOAD ROOM FILES
  useEffect(() => {
    if (!joined || !roomId) return;

    const loadFiles = async () => {
      try {
        const response = await axios.get(`${API_URL}/files/room/${roomId}`);

        setFiles(response.data.files || []);
      } catch (error) {
        console.error("Load Files Error:", error);

        setMessage("Unable to load shared files");
      }
    };

    loadFiles();
  }, [joined, roomId]);
  // CONNECT ROOM
  const connectRoom = (id, name = "My Shared Room") => {
    const cleanId = id.trim().toUpperCase();

    if (!cleanId) {
      setMessage("Please enter a Room ID");

      return;
    }

    if (!socketRef.current?.connected) {
      setMessage("Server connection unavailable");

      return;
    }

    setFiles([]);

    setDevices([]);

    setDeviceCount(0);

    setPendingRequests([]);

    setPendingApproval(false);

    setJoined(false);

    setRoomId(cleanId);

    setRoomName(name);

    socketRef.current.emit("join-room", {
      roomId: cleanId,

      deviceId,

      deviceName,
    });
  };
  // CREATE ROOM
  const createRoom = async (name) => {
    try {
      const response = await axios.post(`${API_URL}/rooms/create`, {
        roomName: name,
      });

      const room = response.data.room;

      connectRoom(room.roomId, room.roomName);
    } catch (error) {
      console.error("Create Room Error:", error);

      setMessage(error.response?.data?.message || "Unable to create room");
    }
  };
  // JOIN ROOM
  const joinRoom = async (id) => {
    try {
      const cleanId = id.trim().toUpperCase();

      const response = await axios.get(`${API_URL}/rooms/join/${cleanId}`);

      const room = response.data.room;

      connectRoom(room.roomId, room.roomName);
    } catch (error) {
      console.error("Join Room Error:", error);

      setMessage(error.response?.data?.message || "Invalid Room ID");
    }
  };
  // UPLOAD FILES WITH INDIVIDUAL PROGRESS
  const uploadFiles = async (selectedFiles) => {
    if (!joined || !roomId) {
      setMessage("Join a room before uploading");

      return;
    }

    if (!selectedFiles?.length) return;

    const items = Array.from(selectedFiles).map((file) => ({
      id: `${file.name}-${file.size}-${Math.random()}`,

      name: file.name,

      size: file.size,

      progress: 0,

      status: "waiting",

      error: "",
    }));

    setUploadItems(items);

    setUploading(true);

    setProgress(0);

    setMessage("");

    let completedCount = 0;

    for (let index = 0; index < selectedFiles.length; index++) {
      const file = selectedFiles[index];

      const itemId = items[index].id;

      setUploadItems((previous) =>
        previous.map((item) =>
          item.id === itemId ? { ...item, status: "uploading" } : item,
        ),
      );

      try {
        const formData = new FormData();

        formData.append("file", file);

        formData.append("roomId", roomId);

        formData.append("uploadedBy", deviceName);

        await axios.post(`${API_URL}/files/upload`, formData, {
          onUploadProgress: (event) => {
            if (!event.total) return;

            const percent = Math.round((event.loaded * 100) / event.total);

            setUploadItems((previous) =>
              previous.map((item) =>
                item.id === itemId ? { ...item, progress: percent } : item,
              ),
            );

            const totalProgress = Math.round(
              ((completedCount + percent / 100) / selectedFiles.length) * 100,
            );

            setProgress(totalProgress);
          },
        });

        completedCount++;

        setUploadItems((previous) =>
          previous.map((item) =>
            item.id === itemId
              ? {
                  ...item,

                  progress: 100,

                  status: "completed",
                }
              : item,
          ),
        );

        setProgress(Math.round((completedCount / selectedFiles.length) * 100));
      } catch (error) {
        console.error(`Upload Error (${file.name}):`, error);

        setUploadItems((previous) =>
          previous.map((item) =>
            item.id === itemId
              ? {
                  ...item,

                  status: "failed",

                  error: error.response?.data?.message || "Upload failed",
                }
              : item,
          ),
        );
      }
    }

    setUploading(false);

    const failedCount = selectedFiles.length - completedCount;

    if (failedCount === 0) {
      setProgress(100);

      setMessage("All files uploaded successfully");
    } else {
      setMessage(`${completedCount} uploaded, ${failedCount} failed`);
    }
  };
  // REMOVE DEVICE
  const removeDevice = (targetDeviceId) => {
    const target = devices.find((device) => device.deviceId === targetDeviceId);

    if (!target) return;

    if (target.isHost) {
      setMessage("Host device cannot be removed");

      return;
    }

    const confirmRemove = window.confirm(
      `Remove ${target.deviceName} from this room?`,
    );

    if (!confirmRemove) return;

    socketRef.current?.emit("host-remove-device", {
      deviceId: targetDeviceId,
    });
  };
  // APPROVE DEVICE
  const approveDevice = (targetDeviceId) => {
    socketRef.current?.emit("approve-device", {
      deviceId: targetDeviceId,
    });

    setPendingRequests((previous) =>
      previous.filter((item) => item.deviceId !== targetDeviceId),
    );
  };
  // REJECT DEVICE
  const rejectDevice = (targetDeviceId) => {
    socketRef.current?.emit("reject-device", {
      deviceId: targetDeviceId,
    });

    setPendingRequests((previous) =>
      previous.filter((item) => item.deviceId !== targetDeviceId),
    );
  };
  // LEAVE ROOM
  const leaveRoom = () => {
    if (!joined) return;

    if (uploading) {
      setMessage("Please wait until upload finishes");

      return;
    }

    const confirmLeave = window.confirm(
      "Are you sure you want to leave this room?",
    );

    if (!confirmLeave) return;

    socketRef.current?.emit("leave-room");

    localStorage.removeItem("shareroom_roomId");

    setRoomId("");

    setRoomName("My Shared Room");

    setJoined(false);

    setFiles([]);

    setDevices([]);

    setPendingRequests([]);

    setPendingApproval(false);

    setDeviceCount(0);

    setProgress(0);

    setUploadItems([]);

    setMessage("You left the room successfully");
  };
  // REFRESH FILES
  const refreshFiles = async () => {
    if (!roomId) return;

    try {
      const response = await axios.get(`${API_URL}/files/room/${roomId}`);

      setFiles(response.data.files || []);

      setMessage("Files refreshed successfully");
    } catch {
      setMessage("Unable to refresh files");
    }
  };
  // HOST CHECK
  const isCurrentHost = devices.some(
    (device) => device.deviceId === deviceId && device.isHost,
  );
  // UPLOAD SUMMARY
  const completedUploads = uploadItems.filter(
    (item) => item.status === "completed",
  ).length;

  const failedUploads = uploadItems.filter(
    (item) => item.status === "failed",
  ).length;
  // RENDER
  return (
    <div className="app">
      <Header
        connected={connected}
        devices={joined ? devices : []}
        deviceCount={deviceCount}
        isCurrentHost={isCurrentHost}
        deviceId={deviceId}
        joined={joined}
        onRemoveDevice={removeDevice}
        onLeaveRoom={leaveRoom}
      />

      <main className="container">
        {/* APPROVAL NOTIFICATIONS */}

        {isCurrentHost && pendingRequests.length > 0 && (
          <div className="approval-notifications">
            {pendingRequests.map((request) => (
              <div className="approval-notification" key={request.deviceId}>
                <div className="notification-icon">
                  <ShieldCheck size={25} />
                </div>

                <div className="notification-content">
                  <div className="notification-title">
                    <h3>Device Access Request</h3>

                    <span>NEW</span>
                  </div>

                  <p>
                    <strong>{request.deviceName}</strong> wants to join your
                    room.
                  </p>

                  <small>Device ID: {request.deviceId}</small>

                  <div className="notification-actions">
                    <button
                      className="notification-approve"
                      onClick={() => approveDevice(request.deviceId)}
                    >
                      <CheckCircle size={15} />
                      Approve
                    </button>

                    <button
                      className="notification-reject"
                      onClick={() => rejectDevice(request.deviceId)}
                    >
                      <XCircle size={15} />
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* WELCOME */}

        <section className="welcome-section">
          <div>
            <span className="eyebrow">LOCAL NETWORK TRANSFER</span>

            <h1>
              Share files.
              <span> Simply.</span>
            </h1>

            <p>
              Transfer files between devices instantly, without cables or cloud
              uploads.
            </p>
          </div>

          <div className="connection-illustration">
            <Monitor size={43} />

            <div className="connection-line">
              <Wifi size={23} />
            </div>

            <Laptop size={43} />
          </div>
        </section>

        {/* MESSAGE */}

        {message && (
          <div className="message-banner">
            <span>{message}</span>

            <button onClick={() => setMessage("")}>×</button>
          </div>
        )}

        {/* ROOM PANEL */}

        <RoomPanel
          roomId={joined ? roomId : ""}
          roomName={roomName}
          onCreate={createRoom}
          onJoin={joinRoom}
        />

        {/* WAITING FOR APPROVAL */}

        {!joined && pendingApproval && (
          <section className="approval-waiting">
            <ShieldCheck size={35} />

            <h2>Waiting for Host Approval</h2>

            <p>
              Your request has been sent to the room host. You can enter the
              room after approval.
            </p>
          </section>
        )}

        {/* ROOM DASHBOARD */}

        {joined && (
          <>
            {/* STATISTICS */}

            <section className="stats-grid">
              <div className="stat-card">
                <div className="stat-icon purple">
                  <Users />
                </div>

                <div>
                  <span>Connected Devices</span>

                  <h2>{deviceCount}</h2>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon blue">
                  <Files />
                </div>

                <div>
                  <span>Shared Files</span>

                  <h2>{files.length}</h2>
                </div>
              </div>

              <div className="stat-card">
                <div className="stat-icon green">
                  <Wifi />
                </div>

                <div>
                  <span>Room Status</span>

                  <h2 className="active-text">Active</h2>
                </div>
              </div>
            </section>

            {/* UPLOAD ZONE */}

            <UploadZone
              onUpload={uploadFiles}
              uploading={uploading}
              progress={progress}
            />

            {/* UPLOAD PROGRESS DASHBOARD */}

            {uploadItems.length > 0 && (
              <section className="upload-dashboard">
                <div className="upload-dashboard-heading">
                  <div>
                    <h2>Upload Progress</h2>

                    <p>
                      {completedUploads} completed
                      {" · "}
                      {failedUploads} failed
                      {" · "}
                      {uploadItems.length} total files
                    </p>
                  </div>
                </div>

                <div className="upload-overall">
                  <div className="upload-overall-info">
                    <span>Overall Progress</span>

                    <strong>{progress}%</strong>
                  </div>

                  <div className="upload-overall-track">
                    <div
                      className="upload-overall-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="upload-items">
                  {uploadItems.map((item) => (
                    <div className="upload-item" key={item.id}>
                      <div className="upload-item-icon">
                        <File size={21} />
                      </div>

                      <div className="upload-item-info">
                        <div className="upload-item-top">
                          <div>
                            <h4 title={item.name}>{item.name}</h4>

                            <span>
                              {(item.size / (1024 * 1024)).toFixed(2)} MB
                            </span>
                          </div>

                          <div className={`upload-status ${item.status}`}>
                            {item.status === "completed" && (
                              <>
                                <Check size={14} />
                                Completed
                              </>
                            )}

                            {item.status === "uploading" && "Uploading"}

                            {item.status === "waiting" && "Waiting"}

                            {item.status === "failed" && (
                              <>
                                <AlertCircle size={14} />
                                Failed
                              </>
                            )}
                          </div>
                        </div>

                        <div className="upload-item-track">
                          <div
                            className={`upload-item-fill ${item.status}`}
                            style={{ width: `${item.progress}%` }}
                          />
                        </div>

                        <div className="upload-item-bottom">
                          <span>
                            {item.error ||
                              (item.status === "waiting"
                                ? "Waiting to upload"
                                : item.status === "failed"
                                  ? "Upload failed"
                                  : item.status === "completed"
                                    ? "Upload completed"
                                    : "Uploading file...")}
                          </span>

                          <strong>{item.progress}%</strong>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* SHARED FILES */}

            <section className="files-section">
              <div className="files-heading">
                <div>
                  <h2>Shared Files</h2>

                  <p>Files available in this room</p>
                </div>

                <div className="room-actions">
                  <button
                    className="refresh-button"
                    onClick={refreshFiles}
                    type="button"
                    title="Refresh Files"
                    aria-label="Refresh Files"
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
              </div>

              <FileList
                files={files}
                isHost={isCurrentHost}
                roomId={roomId}
                deviceId={deviceId}
              />
            </section>
          </>
        )}

        {/* WAITING SECTION */}

        {!joined && !pendingApproval && (
          <div className="waiting-section">
            <Wifi size={30} />

            <h3>Create or join a room to get started</h3>

            <p>Your shared workspace will appear here.</p>
          </div>
        )}

        {/* FOOTER */}

        <footer>
          <p>ShareRoom © 2026 · Local Network File Sharing</p>
        </footer>
      </main>
    </div>
  );
}
