import { useLocalParticipant } from '@livekit/components-react'
import { Track } from 'livekit-client'
import {
  Mic, MicOff, Video, VideoOff, MonitorUp, MonitorOff, PhoneOff,
} from 'lucide-react'

export default function ControlBar({ onLeave, rightSlot }) {
  const { localParticipant } = useLocalParticipant()

  const micOn = localParticipant?.isMicrophoneEnabled
  const camOn = localParticipant?.isCameraEnabled
  const screenOn = localParticipant?.isScreenShareEnabled

  const toggleMic = () =>
    localParticipant?.setMicrophoneEnabled(!micOn)
  const toggleCam = () =>
    localParticipant?.setCameraEnabled(!camOn)
  const toggleScreen = () =>
    localParticipant?.setScreenShareEnabled(!screenOn)

  return (
    <div className="relative flex items-center justify-center gap-2 p-3 bg-zinc-900/95 border-t border-zinc-800">
      <Btn on={micOn} onClick={toggleMic} title={micOn ? 'Mute' : 'Unmute'}>
        {micOn ? <Mic size={18} /> : <MicOff size={18} />}
      </Btn>
      <Btn on={camOn} onClick={toggleCam} title={camOn ? 'Stop video' : 'Start video'}>
        {camOn ? <Video size={18} /> : <VideoOff size={18} />}
      </Btn>
      <Btn on={screenOn} onClick={toggleScreen} title={screenOn ? 'Stop sharing' : 'Share screen'}>
        {screenOn ? <MonitorOff size={18} /> : <MonitorUp size={18} />}
      </Btn>
      <button
        onClick={onLeave}
        className="ml-4 px-4 py-2 rounded-full bg-red-600 hover:bg-red-700 text-white flex items-center gap-2"
        title="Leave"
      >
        <PhoneOff size={18} />
        <span className="text-sm font-medium">Leave</span>
      </button>
      {rightSlot && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {rightSlot}
        </div>
      )}
    </div>
  )
}

function Btn({ on, onClick, title, children }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        'w-11 h-11 grid place-items-center rounded-full transition-colors ' +
        (on
          ? 'bg-zinc-700 hover:bg-zinc-600 text-white'
          : 'bg-red-600 hover:bg-red-700 text-white')
      }
    >
      {children}
    </button>
  )
}
