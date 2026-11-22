import {
  Monitor,
  Wifi,
  WifiOff,
  Users,
  ChevronDown,
  CircleUserRound,
  Crown,
  LogOut,
} from "lucide-react";

export default function Header({
  connected,
  devices = [],
  deviceCount = 0,
  isCurrentHost = false,
  deviceId = "",
  joined = false,
  onRemoveDevice,
  onLeaveRoom,
}) {
  return (
    <header className="header">
      <div className="header-inner">
        {/* BRAND */}
        <div className="header-brand">
          <div className="brand-icon">
            <Monitor size={23} />
          </div>

          <div>
            <h2>ShareRoom</h2>
            <span>Local Network Sharing</span>
          </div>
        </div>

        {/* HEADER ACTIONS */}
        <div className="header-actions">
          {/* DEVICE DROPDOWN */}
          {joined && devices.length > 0 && (
            <div className="header-device-dropdown">
              <details>
                <summary className="header-device-button">
                  <Users size={17} />
                  <span>Devices</span>

                  <span className="header-device-count">{deviceCount}</span>

                  <ChevronDown size={15} className="header-chevron" />
                </summary>

                <div className="header-device-menu">
                  <div className="header-device-menu-title">
                    <div>
                      <h3>Connected Devices</h3>
                      <p>{deviceCount} devices online</p>
                    </div>
                  </div>

                  <div className="header-device-list">
                    {devices.map((device) => {
                      const isCurrentDevice = device.deviceId === deviceId;

                      return (
                        <div
                          className="header-device-item"
                          key={device.deviceId}
                        >
                          <div className="header-device-avatar">
                            <CircleUserRound size={21} />
                          </div>

                          <div className="header-device-info">
                            <strong>{device.deviceName}</strong>

                            <span>
                              {device.online ? "Online" : "Offline"}

                              {isCurrentDevice && " · This Device"}
                            </span>

                            {device.isHost && (
                              <small>
                                <Crown size={11} />
                                HOST DEVICE
                              </small>
                            )}
                          </div>

                          {/* REMOVE DEVICE */}
                          {isCurrentHost &&
                            !device.isHost &&
                            !isCurrentDevice && (
                              <button
                                className="header-remove-device"
                                onClick={() =>
                                  onRemoveDevice?.(device.deviceId)
                                }
                                disabled={!device.online}
                                title="Remove Device"
                                aria-label={`Remove ${device.deviceName}`}
                              >
                                <LogOut size={15} />
                              </button>
                            )}

                          <span
                            className={
                              device.online
                                ? "header-online-dot"
                                : "header-offline-dot"
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </details>
            </div>
          )}

          {/* CONNECTION STATUS */}
          <div
            className={`connection-status ${connected ? "online" : "offline"}`}
          >
            {connected ? <Wifi size={16} /> : <WifiOff size={16} />}

            <span>{connected ? "Connected" : "Disconnected"}</span>
          </div>

          {/* LEAVE ROOM BUTTON */}
          {joined && (
            <button
              className="header-leave-button"
              onClick={onLeaveRoom}
              type="button"
              title="Leave Room"
              aria-label="Leave Room"
            >
              <LogOut size={17} />
              <span>Leave</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
