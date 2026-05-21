import { useEffect, useState } from 'react'
import { api } from '../api/client'
import Icon from '../components/Icon'
import Avatar from '../components/Avatar'
import './Admin.css'

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function Admin() {
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [meetings, setMeetings] = useState([])
  const [activity, setActivity] = useState([])
  const [tab, setTab] = useState('overview')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    Promise.all([
      api('/api/admin/stats'),
      api('/api/admin/users?limit=50'),
      api('/api/admin/meetings?limit=30'),
      api('/api/admin/activity?limit=20'),
    ])
      .then(([s, u, m, a]) => {
        setStats(s)
        setUsers(u)
        setMeetings(m)
        setActivity(a)
      })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false))
  }, [])

  const searchUsers = async () => {
    try {
      const res = await api(`/api/admin/users?search=${encodeURIComponent(search)}&limit=50`)
      setUsers(res)
    } catch {}
  }

  const deleteUser = async (userId) => {
    if (!window.confirm('Permanently delete this user?')) return
    try {
      await api(`/api/admin/users/${userId}`, { method: 'DELETE' })
      setUsers(prev => prev.filter(u => u.id !== userId))
    } catch (e) {
      setErr(e.message)
    }
  }

  const purgeRecordings = async () => {
    const days = window.prompt(
      'Purge recordings older than how many days? (Leave blank for the configured retention)',
      ''
    )
    if (days === null) return
    const parsed = days.trim() === '' ? null : parseInt(days, 10)
    if (parsed !== null && (!Number.isFinite(parsed) || parsed < 1)) {
      window.alert('Days must be a positive integer')
      return
    }
    if (!window.confirm(parsed ? `Purge recordings older than ${parsed} days?` : 'Purge expired recordings using server retention?')) return
    try {
      const qs = parsed ? `?days=${parsed}` : ''
      const res = await api(`/api/admin/recordings/purge${qs}`, { method: 'POST' })
      window.alert(`Purged ${res.purged} recording${res.purged === 1 ? '' : 's'} (retention ${res.retention_days}d).`)
      // Refresh the stat card so the counter reflects the purge.
      try { setStats(await api('/api/admin/stats')) } catch {}
    } catch (e) {
      window.alert(`Purge failed: ${e.message}`)
    }
  }

  if (loading) {
    return (
      <div className="admin">
        <div style={{ display: 'grid', placeItems: 'center', padding: 80 }}>
          <div className="spinner" />
        </div>
      </div>
    )
  }

  if (err && !stats) {
    return (
      <div className="admin">
        <div className="admin-error">
          <Icon name="shield" size={32} />
          <h2>Access denied</h2>
          <p>{err}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="admin">
      <header className="admin-hero">
        <div className="admin-hero-top">
          <span className="badge accent">
            <Icon name="userCog" size={12} />
            <span>Admin Panel</span>
          </span>
        </div>
        <h1 className="admin-hero-title">System Administration</h1>
        <p className="admin-hero-sub">Monitor your platform, manage users, and review system activity.</p>
      </header>

      {/* Tabs */}
      <div className="admin-tabs">
        {[
          { key: 'overview', label: 'Overview', icon: 'chart' },
          { key: 'users', label: 'Users', icon: 'users' },
          { key: 'meetings', label: 'Meetings', icon: 'video' },
          { key: 'activity', label: 'Activity', icon: 'activity' },
        ].map(t => (
          <button
            key={t.key}
            className={'admin-tab' + (tab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}
          >
            <Icon name={t.icon} size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === 'overview' && stats && (
        <>
        <div className="admin-actions" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '0 0 16px' }}>
          <button className="ghost" onClick={purgeRecordings} title="Run the expired-recordings sweep now">
            <Icon name="trash" size={14} /> Purge old recordings
          </button>
        </div>
        <div className="admin-stats">
          {[
            { label: 'Total users', value: stats.total_users, icon: 'users', accent: true },
            { label: 'New this week', value: stats.users_this_week, icon: 'trendUp' },
            { label: 'Total meetings', value: stats.total_meetings, icon: 'video' },
            { label: 'This week', value: stats.meetings_this_week, icon: 'calendar' },
            { label: 'This month', value: stats.meetings_this_month, icon: 'calendar' },
            { label: 'Active now', value: stats.active_meetings, icon: 'bolt', accent: true },
            { label: 'Recordings', value: stats.total_recordings, icon: 'record' },
            { label: 'Organizations', value: stats.total_organizations, icon: 'building' },
            { label: 'Total joins', value: stats.total_participants_joined, icon: 'userPlus' },
          ].map((s, i) => (
            <div key={i} className="admin-stat-card">
              <div className={'admin-stat-icon' + (s.accent ? ' accent' : '')}>
                <Icon name={s.icon} size={18} />
              </div>
              <div className="admin-stat-value">{s.value}</div>
              <div className="admin-stat-label">{s.label}</div>
            </div>
          ))}
        </div>
        </>
      )}

      {/* Users */}
      {tab === 'users' && (
        <div className="admin-section">
          <div className="admin-search-row">
            <div className="admin-search">
              <Icon name="search" size={14} />
              <input
                placeholder="Search users by name or email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') searchUsers() }}
              />
            </div>
            <button className="primary" onClick={searchUsers}>Search</button>
          </div>
          <div className="admin-table">
            <div className="admin-table-head">
              <span>User</span>
              <span>Email</span>
              <span>Meetings</span>
              <span>Joined</span>
              <span>Actions</span>
            </div>
            {users.map(u => (
              <div key={u.id} className="admin-table-row">
                <span className="admin-table-cell admin-user-cell">
                  <Avatar name={u.name} color={u.avatar_color} size="sm" />
                  <div>
                    <div className="admin-user-name">
                      {u.name}
                      {u.is_admin && <span className="badge sm accent">Admin</span>}
                    </div>
                  </div>
                </span>
                <span className="admin-table-cell admin-email">{u.email}</span>
                <span className="admin-table-cell">{u.meeting_count}</span>
                <span className="admin-table-cell">{formatDate(u.created_at)}</span>
                <span className="admin-table-cell">
                  {!u.is_admin && (
                    <button className="ghost admin-delete-btn" onClick={() => deleteUser(u.id)} title="Delete user">
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Meetings */}
      {tab === 'meetings' && (
        <div className="admin-section">
          <div className="admin-table">
            <div className="admin-table-head">
              <span>Meeting</span>
              <span>Host</span>
              <span>Participants</span>
              <span>Status</span>
              <span>Created</span>
            </div>
            {meetings.map(m => (
              <div key={m.id} className="admin-table-row">
                <span className="admin-table-cell">
                  <div className="admin-meeting-title">{m.title}</div>
                  <div className="admin-meeting-code mono">{m.code}</div>
                </span>
                <span className="admin-table-cell">
                  {m.host_name}
                  <div className="admin-meeting-code">{m.host_email}</div>
                </span>
                <span className="admin-table-cell">{m.participant_count}</span>
                <span className="admin-table-cell">
                  <span className={'badge sm ' + (m.is_active ? 'live' : 'muted')}>
                    {m.is_active ? 'Active' : 'Ended'}
                  </span>
                  {m.locked && <span className="badge sm" style={{ marginLeft: 4 }}>Locked</span>}
                  {m.password_protected && <Icon name="lock" size={11} style={{ marginLeft: 4, color: 'var(--muted)' }} />}
                </span>
                <span className="admin-table-cell">{formatDate(m.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Activity */}
      {tab === 'activity' && (
        <div className="admin-section">
          <div className="admin-activity">
            {activity.map((e, i) => (
              <div key={i} className="admin-activity-item">
                <div className={'admin-activity-icon ' + e.type}>
                  <Icon name={e.type === 'user_signup' ? 'userPlus' : 'video'} size={14} />
                </div>
                <div className="admin-activity-body">
                  <div className="admin-activity-msg">{e.message}</div>
                  <div className="admin-activity-time">{formatDate(e.timestamp)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
