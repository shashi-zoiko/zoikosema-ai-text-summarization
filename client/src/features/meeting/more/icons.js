import {
  Wand2, Grid3x3, SquareUser, MonitorPlay, PanelRight, Focus, Maximize,
  PictureInPicture2, CircleUser, Image, Frame, Sun, AudioLines, Settings2,
  Volume2, Camera, Activity, Video, ClipboardCopy, Keyboard, HelpCircle,
  AlertTriangle, ShieldAlert, Accessibility, Settings, Pin, Monitor, Circle,
} from 'lucide-react'

/**
 * Maps the registry's declarative `icon` name strings to lucide-react components.
 * Keeps the registry serializable/declarative (no component refs) and the icon
 * dependency isolated to the render layer. Reuses the app's existing lucide set.
 */
const ICONS = {
  Wand2, Grid3x3, SquareUser, MonitorPlay, PanelRight, Focus, Maximize,
  PictureInPicture2, CircleUser, Image, Frame, Sun, AudioLines, Settings2,
  Volume2, Camera, Activity, Video, ClipboardCopy, Keyboard, HelpCircle,
  AlertTriangle, ShieldAlert, Accessibility, Settings, Pin, Monitor,
}

export function getMoreMenuIcon(name) {
  return ICONS[name] || Circle
}
