// Icons render as inline SVGs (lucide-react), not a ligature icon font.
//
// Why: the old Material Symbols font showed the raw ligature TEXT ("person",
// "favorite", …) until the font finished downloading — a broken-looking first paint
// on slow connections (FOIT). SVGs ship inside the JS bundle, so they paint instantly:
// no font request, no flash of text.
//
// The public API (<Icon name="…" />) and the `material-symbols-rounded` class are kept
// unchanged so all ~370 call sites and every existing size/color CSS rule keep working.
// Sizing still comes from CSS `font-size`; index.css maps that onto the SVG via
// `width/height: 1em`, and color flows through `currentColor` as before.
import {
  Plus, Camera, Link, ImagePlus, AtSign, ChartColumn, ArrowLeft, FileText, BookOpen,
  ListChecks, Ban, Bookmark, Building2, Calendar, ArrowUpRight, ArrowDownLeft,
  MessageSquare, MessageCircle, Check, SquareCheck, Square, CircleCheck, X, CloudOff,
  Code, Code2, Library, Copy, Crop, Moon, LayoutDashboard, Trash2, Palette, CheckCheck,
  Download, GripVertical, Pencil, SquarePen, CircleAlert, ChevronUp, ChevronDown, Heart,
  FolderOpen, Quote, MessagesSquare, LayoutGrid, Users, UserPlus, Sun, Lightbulb,
  House, Hourglass, Vote, Image, Inbox, Info, Share, Globe, ListPlus, Unlink,
  Lock, LogOut, UserCog, MessageSquareDot, Menu, Ellipsis, Film, Music, Newspaper, Bell, BellRing,
  ExternalLink, CirclePause, User, UserMinus, Play, ChartNoAxesColumn, RefreshCw, Repeat2,
  RotateCcw, RotateCw, Clock, Search, Send, Settings, Share2, Shield, MonitorPlay,
  Tag, Heading, TrendingUp, SlidersHorizontal, ChevronsUpDown, Upload, Video, Eye, EyeOff,
  TriangleAlert, WifiOff, Briefcase, ZoomIn, ZoomOut, CircleHelp,
  Mail, Key, LockOpen, Bold, Italic, Underline, Strikethrough, List, ListOrdered,
  AlignLeft, AlignCenter, AlignRight, Minus, Highlighter, Redo2, Undo2, Table, Terminal, Paperclip,
  Save, ChevronLeft, ChevronRight,
  Smartphone, Tablet, Laptop, Bot,
} from 'lucide-react';

// Material Symbols name → lucide-react component. Covers every name used across the app
// (static <Icon name="…">, conditional names, and data-driven chip/registry icons).
const ICONS = {
  add: Plus, add_a_photo: Camera, add_link: Link, add_photo_alternate: ImagePlus,
  alternate_email: AtSign, analytics: ChartColumn, smart_toy: Bot, arrow_back: ArrowLeft, article: FileText,
  auto_stories: BookOpen, ballot: ListChecks, bar_chart: ChartColumn, block: Ban,
  bookmark: Bookmark, bookmark_border: Bookmark, business: Building2, calendar_month: Calendar,
  call_made: ArrowUpRight, call_received: ArrowDownLeft, chat: MessageSquare, chat_bubble: MessageCircle,
  chat_bubble_outline: MessageCircle, check: Check, check_box: SquareCheck, check_box_outline_blank: Square,
  check_circle: CircleCheck, close: X, cloud_off: CloudOff, code: Code, code_blocks: Code2,
  collections_bookmark: Library, content_copy: Copy, crop: Crop, dark_mode: Moon,
  dashboard: LayoutDashboard, delete: Trash2, delete_forever: Trash2, delete_outline: Trash2,
  delete_sweep: Trash2, design_services: Palette, done_all: CheckCheck, download: Download,
  draft: FileText, drag_indicator: GripVertical, edit: Pencil, edit_note: SquarePen, save: Save,
  chevron_left: ChevronLeft, chevron_right: ChevronRight,
  smartphone: Smartphone, tablet_mac: Tablet, laptop: Laptop,
  error: CircleAlert, expand_less: ChevronUp, expand_more: ChevronDown, favorite: Heart,
  favorite_border: Heart, feedback: Lightbulb, folder_open: FolderOpen, format_quote: Quote,
  forum: MessagesSquare, grid_view: LayoutGrid, group: Users, group_add: UserPlus,
  home: House, hourglass_empty: Hourglass, how_to_vote: Vote,
  image: Image, import_contacts: Newspaper, inbox: Inbox, info: Info, ios_share: Share,
  keyboard_arrow_down: ChevronDown, keyboard_arrow_up: ChevronUp, language: Globe, library_add: ListPlus, light_mode: Sun,
  link: Link, link_off: Unlink, lock: Lock, logout: LogOut, manage_accounts: UserCog,
  mark_chat_unread: MessageSquareDot, menu: Menu, menu_book: BookOpen, more_horiz: Ellipsis,
  movie: Film, music_note: Music, notifications: Bell, notifications_active: BellRing,
  open_in_new: ExternalLink, pause_circle: CirclePause, people_outline: Users, person: User,
  person_add: UserPlus, person_remove: UserMinus, photo_camera: Camera, play_arrow: Play,
  playlist_add: ListPlus, poll: ChartNoAxesColumn, public: Globe, refresh: RefreshCw, repeat: Repeat2,
  rotate_left: RotateCcw, rotate_right: RotateCw, schedule: Clock, search: Search, send: Send,
  settings: Settings, share: Share2, shield: Shield, smart_display: MonitorPlay,
  subscriptions: Inbox, swipe_up: ChevronUp, sync: RefreshCw, tag: Tag, title: Heading,
  trending_up: TrendingUp, tune: SlidersHorizontal, unfold_more: ChevronsUpDown, update: RefreshCw,
  upload: Upload, videocam: Video, visibility: Eye, visibility_off: EyeOff, warning: TriangleAlert,
  wifi_off: WifiOff, work: Briefcase, zoom_in: ZoomIn, zoom_out: ZoomOut,
  // Auth / input fields
  mail: Mail, key: Key, lock_open: LockOpen,
  // Editor toolbar
  format_bold: Bold, format_italic: Italic, format_underlined: Underline, strikethrough_s: Strikethrough,
  format_list_bulleted: List, format_list_numbered: ListOrdered,
  format_align_left: AlignLeft, format_align_center: AlignCenter, format_align_right: AlignRight,
  horizontal_rule: Minus, ink_highlighter: Highlighter, redo: Redo2, undo: Undo2,
  table_chart: Table, terminal: Terminal, attach_file: Paperclip,
};

// Solid-fill handling. `favorite` is inherently the filled heart — its outline counterpart is the
// SEPARATE `favorite_border` name — so it's solid whenever it's rendered (callers switch the name to
// toggle like state). `bookmark` is a single name that's outline by default and only turns solid when
// its `filled` prop is set (the Save toggle), so it must NOT fill unconditionally. Flood-filling any
// other outline lucide glyph just makes a blob, so `filled` on those (active nav tabs) only bolds the
// stroke; active state also reads through color (CSS).
const ALWAYS_FILLED = new Set(['favorite']);
const FILL_WHEN_ACTIVE = new Set(['bookmark']);

const Icon = ({ name, className = '', filled = false, ariaLabel = '', onClick = null, style = {} }) => {
  const LucideIcon = ICONS[name] || CircleHelp;
  const solid = ALWAYS_FILLED.has(name) || (filled && FILL_WHEN_ACTIVE.has(name));
  // Icons are DECORATIVE by default. Falling back to `aria-label={name}` made every one of the ~370
  // call sites announce its raw internal name ("favorite_border", "more_horiz", "ios_share") — noise
  // on decorative glyphs and a duplicate announcement on buttons that already have visible text.
  // Pass `ariaLabel` only when the icon itself is the sole carrier of meaning; otherwise the label
  // belongs on the surrounding button.
  const a11yProps = ariaLabel
    ? { role: 'img', 'aria-label': ariaLabel }
    : { 'aria-hidden': 'true', focusable: 'false' };
  return (
    <LucideIcon
      className={`material-symbols-rounded ${className}`.trim()}
      {...a11yProps}
      onClick={onClick}
      style={style}
      fill={solid ? 'currentColor' : 'none'}
      strokeWidth={filled ? 2.5 : 2}
    />
  );
};

export default Icon;
