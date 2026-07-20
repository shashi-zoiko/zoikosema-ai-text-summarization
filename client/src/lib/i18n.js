const LOCALES = {
  en: {
    'guide.welcome.title': "Hello — I'm Sema Guide",
    'guide.welcome.subtitle': "Zoiko Sema's AI support agent. I can answer questions, help you complete common tasks and connect you with a person when needed.",
    'guide.welcome.help': 'How can I help?',
    'guide.header.title': 'Sema Guide',
    'guide.header.subtitle': 'Zoiko Sema support agent',
    'guide.header.specialist': 'Human Specialist',
    'guide.header.connected': 'Connected',
    'guide.composer.placeholder': 'Ask Sema Guide anything…',
    'guide.overflow.mute': 'Mute notifications',
    'guide.overflow.clear': 'Clear conversation',
    'guide.overflow.handoff': 'Talk to a person',
    'guide.overflow.privacy': 'Privacy & data',
    'guide.overflow.about': 'About Sema Guide',
    'guide.clear.confirm': 'Clear conversation? This clears your local view. Support history and records retained by security, legal or enterprise policy are not affected.',
    'guide.handoff.assigned': "You're speaking with a human specialist. Sema Guide is in background mode.",
    'guide.verified': 'Verified answer',
    'guide.unverified': 'Verify this information before acting',
    'guide.confidential.title': 'Confidential Mode active',
    'guide.confidential.body': 'Sema Guide can help with settings and controls but cannot access meeting audio, video, chat, shared files, transcripts or other meeting content.',
    'guide.action.confirm': 'Confirm',
    'guide.action.edit': 'Edit',
    'guide.action.cancel': 'Cancel',
  },
  fr: {
    'guide.welcome.title': "Bonjour — je suis Sema Guide",
    'guide.welcome.subtitle': "L'agent de support AI de Zoiko Sema. Je peux répondre à vos questions, vous aider à effectuer des tâches courantes et vous mettre en relation avec une personne si nécessaire.",
    'guide.welcome.help': 'Comment puis-je vous aider ?',
    'guide.header.title': 'Sema Guide',
    'guide.header.subtitle': 'Agent de support Zoiko Sema',
    'guide.header.specialist': 'Spécialiste humain',
    'guide.header.connected': 'Connecté',
    'guide.composer.placeholder': 'Demandez à Sema Guide…',
    'guide.overflow.mute': 'Désactiver les notifications',
    'guide.overflow.clear': 'Effacer la conversation',
    'guide.overflow.handoff': 'Parler à une personne',
    'guide.overflow.privacy': 'Confidentialité et données',
    'guide.overflow.about': 'À propos de Sema Guide',
    'guide.clear.confirm': 'Effacer la conversation ? Cela efface votre vue locale. L\'historique de support et les enregistrements conservés par la sécurité, les services juridiques ou la politique d\'entreprise ne sont pas affectés.',
    'guide.handoff.assigned': "Vous parlez avec un spécialiste humain. Sema Guide est en mode assistance en arrière-plan.",
    'guide.verified': 'Réponse vérifiée',
    'guide.unverified': 'Vérifiez cette information avant d\'agir',
    'guide.confidential.title': 'Mode confidentiel actif',
    'guide.confidential.body': 'Sema Guide peut vous aider avec les paramètres et contrôles mais ne peut pas accéder à l\'audio, la vidéo, le chat, les fichiers partagés, les transcriptions ou autres contenus de réunion.',
    'guide.action.confirm': 'Confirmer',
    'guide.action.edit': 'Modifier',
    'guide.action.cancel': 'Annuler',
  },
  de: {
    'guide.welcome.title': 'Hallo — ich bin Sema Guide',
    'guide.welcome.subtitle': 'Der KI-Supportagent von Zoiko Sema. Ich kann Fragen beantworten, bei allgemeinen Aufgaben helfen und Sie bei Bedarf mit einer Person verbinden.',
    'guide.welcome.help': 'Wie kann ich helfen?',
    'guide.header.title': 'Sema Guide',
    'guide.header.subtitle': 'Zoiko Sema Support-Agent',
    'guide.header.specialist': 'Menschlicher Spezialist',
    'guide.header.connected': 'Verbunden',
    'guide.composer.placeholder': 'Fragen Sie Sema Guide…',
    'guide.overflow.mute': 'Benachrichtigungen stummschalten',
    'guide.overflow.clear': 'Unterhaltung löschen',
    'guide.overflow.handoff': 'Mit einer Person sprechen',
    'guide.overflow.privacy': 'Datenschutz & Daten',
    'guide.overflow.about': 'Über Sema Guide',
    'guide.handoff.assigned': 'Sie sprechen mit einem menschlichen Spezialisten. Sema Guide ist im Hintergrundmodus.',
    'guide.verified': 'Verifizierte Antwort',
    'guide.unverified': 'Überprüfen Sie diese Informationen vor dem Handeln',
    'guide.confidential.title': 'Vertraulicher Modus aktiv',
    'guide.confidential.body': 'Sema Guide kann bei Einstellungen und Steuerungen helfen, hat aber keinen Zugriff auf Audio, Video, Chat, geteilte Dateien, Transkripte oder andere Meeting-Inhalte.',
    'guide.action.confirm': 'Bestätigen',
    'guide.action.edit': 'Bearbeiten',
    'guide.action.cancel': 'Abbrechen',
  },
  ja: {
    'guide.welcome.title': 'こんにちは — 私はSema Guideです',
    'guide.welcome.subtitle': 'Zoiko SemaのAIサポートエージェントです。質問への回答、一般的なタスクの完了支援、必要に応じて担当者への接続を行います。',
    'guide.welcome.help': 'どのようなご用件ですか？',
    'guide.header.title': 'Sema Guide',
    'guide.header.subtitle': 'Zoiko Sema サポートエージェント',
    'guide.header.specialist': '人間のスペシャリスト',
    'guide.header.connected': '接続済み',
    'guide.composer.placeholder': 'Sema Guideに質問する…',
    'guide.handoff.assigned': '人間のスペシャリストと話しています。Sema Guideはバックグラウンドモードです。',
    'guide.verified': '確認済みの回答',
    'guide.unverified': '行動する前にこの情報を確認してください',
    'guide.action.confirm': '確認',
    'guide.action.edit': '編集',
    'guide.action.cancel': 'キャンセル',
  },
}

let _locale = 'en'

// Merge a feature package's message fixtures into a locale at load time, so
// features can co-locate their strings without forking a second i18n system.
export function registerMessages(locale, messages) {
  LOCALES[locale] = { ...(LOCALES[locale] || {}), ...messages }
}

export function setLocale(locale) {
  if (LOCALES[locale]) {
    _locale = locale
    document.documentElement.lang = locale
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr'
  }
}

export function t(key, params = {}) {
  const locale = LOCALES[_locale] || LOCALES.en
  let value = locale[key] || LOCALES.en[key] || key
  for (const [k, v] of Object.entries(params)) {
    value = value.replace(`{${k}}`, v)
  }
  return value
}

export function getLocale() {
  return _locale
}

export function getLocales() {
  return Object.keys(LOCALES)
}
