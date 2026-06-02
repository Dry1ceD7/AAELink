'use client'

import { useState, useCallback, useEffect } from 'react'
import { Sparkles, BarChart3, MessageCircle, PenLine, User, FileText, X, Loader2 } from 'lucide-react'

/* ─────────────────────────────────────────────────────────────────────
   AISummaryPanel — Slack AI summaries
   • One-click AI summaries of threads and channel recaps
   • AI document analysis (upload + summarize)
   • Slackbot-style conversational AI
   • Tone-matched message drafting
   ───────────────────────────────────────────────────────────────────── */

interface SummaryItem {
  id: string
  type: 'thread_summary' | 'channel_recap' | 'doc_analysis' | 'message_draft'
  title: string
  content: string
  sourceChannel?: string
  timestamp: string
  keyPoints?: string[]
  actionItems?: string[]
}

export default function AISummaryPanel({ channelName, onClose }: {
  channelName?: string
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<'summaries' | 'ask' | 'drafts'>('summaries')
  const [askInput, setAskInput] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [conversation, setConversation] = useState<{ role: 'user' | 'ai'; text: string }[]>([])
  const [summaries, setSummaries] = useState<SummaryItem[]>([])
  const [summariesLoading, setSummariesLoading] = useState(false)
  const [summariesLoaded, setSummariesLoaded] = useState(false)

  /** Fetch recent channel activity and build a recap via the assistant API */
  const generateSummary = useCallback(async () => {
    const channel = channelName || 'general'
    setSummariesLoading(true)
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search_context', query: channel }),
      })
      const data = await res.json()
      if (data.results && data.results.length > 0) {
        const messages = data.results as Array<{
          channel_name?: string; user_name?: string; text?: string; created_at?: number
        }>
        // Build a recap from real message data
        const keyPoints = messages.slice(0, 6).map(
          (m) => `${m.user_name || 'User'}: ${String(m.text || '').slice(0, 100)}`
        )
        const recap: SummaryItem = {
          id: `recap-${Date.now()}`,
          type: 'channel_recap',
          title: `#${channel} — Recent Activity`,
          content: `Found ${messages.length} recent message${messages.length === 1 ? '' : 's'} in #${channel}. Here's a snapshot of the latest activity.`,
          sourceChannel: channel,
          timestamp: 'Just now',
          keyPoints,
        }
        setSummaries(prev => [recap, ...prev])
      } else {
        setSummaries(prev => [{
          id: `empty-${Date.now()}`,
          type: 'channel_recap',
          title: `#${channel} — No Recent Activity`,
          content: `No recent messages found in #${channel}. Activity will appear here as conversations happen.`,
          sourceChannel: channel,
          timestamp: 'Just now',
        }, ...prev])
      }
      setSummariesLoaded(true)
    } catch {
      setSummaries(prev => [{
        id: `error-${Date.now()}`,
        type: 'channel_recap',
        title: `Summary unavailable`,
        content: 'Could not generate a summary at this time. Please try again later.',
        timestamp: 'Just now',
      }, ...prev])
    } finally {
      setSummariesLoading(false)
    }
  }, [channelName])

  /** Auto-load summaries on first tab visit */
  useEffect(() => {
    if (activeTab === 'summaries' && !summariesLoaded && !summariesLoading) {
      generateSummary()
    }
  }, [activeTab, summariesLoaded, summariesLoading, generateSummary])

  const askAI = useCallback(async () => {
    if (!askInput.trim()) return
    const question = askInput.trim()
    setConversation(prev => [...prev, { role: 'user', text: question }])
    setAskInput('')
    setIsProcessing(true)

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'search_context', query: question }),
      })
      const data = await res.json()
      if (data.results && data.results.length > 0) {
        const hits = data.results
          .map((r: { channel_name?: string; user_name?: string; text?: string }) =>
            `• [#${r.channel_name || 'unknown'}] ${r.user_name || 'User'}: ${String(r.text || '').slice(0, 120)}…`
          )
          .join('\n')
        setConversation(prev => [...prev, {
          role: 'ai',
          text: `Here's what I found for "${question}":\n\n${hits}\n\nWould you like me to summarize these results or search for something else?`,
        }])
      } else {
        setConversation(prev => [...prev, {
          role: 'ai',
          text: `I searched across your channels for "${question}" but didn't find any matching messages. Try a different search term or ask me to summarize a specific channel.`,
        }])
      }
    } catch {
      setConversation(prev => [...prev, {
        role: 'ai',
        text: 'Sorry, I encountered an error while searching. Please try again in a moment.',
      }])
    } finally {
      setIsProcessing(false)
    }
  }, [askInput])

  const TABS = [
    { key: 'summaries' as const, label: 'Summaries', Icon: BarChart3 },
    { key: 'ask' as const, label: 'Ask AI', Icon: MessageCircle },
    { key: 'drafts' as const, label: 'Draft', Icon: PenLine },
  ]

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: 'var(--mm-main-bg)', color: 'var(--mm-text)',
      borderLeft: '1px solid var(--mm-border)',
      animation: 'slack-panel-slide-in 250ms var(--slack-ease-out) forwards',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: '1px solid var(--mm-border)',
        background: 'linear-gradient(135deg, rgba(67,97,238,0.06), rgba(76,201,240,0.04))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              width: 28, height: 28, borderRadius: 8,
              background: 'linear-gradient(135deg, #4361EE, #4CC9F0)',
              display: 'grid', placeItems: 'center',
            }}><Sparkles size={14} color="#fff" /></span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>AAELink AI</span>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none',
            cursor: 'pointer', color: 'var(--mm-muted)',
          }}><X size={18} /></button>
        </div>

        <div style={{ display: 'flex', gap: 4 }}>
          {TABS.map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
              padding: '6px 12px', borderRadius: 8, border: 'none',
              cursor: 'pointer', fontSize: 12, fontWeight: activeTab === tab.key ? 700 : 400,
              background: activeTab === tab.key ? 'var(--mm-hover-bg)' : 'none',
              color: activeTab === tab.key ? 'var(--mm-link)' : 'var(--mm-muted)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}><tab.Icon size={13} /> {tab.label}</button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {activeTab === 'summaries' && (
          <div style={{ padding: 16 }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button onClick={generateSummary} disabled={summariesLoading} style={{
                background: '#4361EE', border: 'none', borderRadius: 8,
                padding: '8px 16px', color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: summariesLoading ? 'default' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
                opacity: summariesLoading ? 0.6 : 1,
              }}>
                {summariesLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} />}
                {summariesLoading ? 'Summarizing…' : `Summarize #${channelName || 'channel'}`}
              </button>
              <button style={{
                background: 'none', border: '1px solid var(--mm-border)',
                borderRadius: 8, padding: '8px 16px', fontSize: 13,
                cursor: 'pointer', color: 'var(--mm-text)', display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <FileText size={13} /> Analyze document
              </button>
            </div>

            {summariesLoading && summaries.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>
                <Loader2 size={28} style={{ animation: 'spin 1s linear infinite', marginBottom: 8 }} />
                <div style={{ fontSize: 13 }}>Generating summary…</div>
              </div>
            )}

            {!summariesLoading && summaries.length === 0 && (
              <div style={{ textAlign: 'center', padding: 40, opacity: 0.5 }}>
                <Sparkles size={28} style={{ marginBottom: 8, opacity: 0.5 }} />
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>No summaries yet</div>
                <div style={{ fontSize: 13 }}>Click &quot;Summarize&quot; above to generate a recap of recent channel activity.</div>
              </div>
            )}

            {summaries.map(summary => (
              <div key={summary.id} style={{
                marginBottom: 16, padding: 16, borderRadius: 12,
                border: '1px solid var(--mm-border)',
                background: 'var(--mm-rhs-bg)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{
                    fontSize: 10, padding: '2px 8px', borderRadius: 6,
                    background: summary.type === 'channel_recap' ? 'rgba(67,97,238,0.12)' : summary.type === 'thread_summary' ? 'rgba(43,172,118,0.12)' : 'rgba(232,168,32,0.12)',
                    color: summary.type === 'channel_recap' ? '#4361EE' : summary.type === 'thread_summary' ? '#2bac76' : '#e8a820',
                    fontWeight: 600,
                  }}>
                    {summary.type === 'channel_recap' ? 'Channel Recap' : summary.type === 'thread_summary' ? 'Thread Summary' : 'Doc Analysis'}
                  </span>
                  <span style={{ fontSize: 11, opacity: 0.4, marginLeft: 'auto' }}>{summary.timestamp}</span>
                </div>

                <h4 style={{ margin: '0 0 8px', fontSize: 14, fontWeight: 700 }}>{summary.title}</h4>
                <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.6, opacity: 0.85 }}>{summary.content}</p>

                {summary.keyPoints && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Key Points</div>
                    {summary.keyPoints.map((point, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 6,
                        fontSize: 13, lineHeight: 1.5, marginBottom: 4,
                      }}>
                        <span style={{ color: '#4361EE', fontWeight: 700 }}>•</span>
                        <span>{point}</span>
                      </div>
                    ))}
                  </div>
                )}

                {summary.actionItems && (
                  <div style={{
                    background: 'rgba(67,97,238,0.06)', borderRadius: 8,
                    padding: 12, borderLeft: '3px solid #4361EE',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#4361EE', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Action Items</div>
                    {summary.actionItems.map((item, i) => (
                      <div key={i} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        fontSize: 13, lineHeight: 1.5, marginBottom: 4,
                      }}>
                        <input type="checkbox" style={{ accentColor: '#4361EE', width: 14, height: 14 }} />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {activeTab === 'ask' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, padding: 16, overflowY: 'auto' }}>
              {conversation.length === 0 && (
                <div style={{
                  textAlign: 'center', padding: 40, opacity: 0.5,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><Sparkles size={40} style={{ opacity: 0.5 }} /></div>
                  <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>Ask AAELink AI anything</div>
                  <div style={{ fontSize: 13 }}>I can search your channels, summarize threads, and help you find information.</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
                    {[
                      "What was discussed in #engineering today?",
                      "Summarize the last 50 messages in this channel",
                      "What are my open action items?",
                    ].map(suggestion => (
                      <button key={suggestion} onClick={() => { setAskInput(suggestion) }} style={{
                        background: 'var(--mm-hover-bg)', border: '1px solid var(--mm-border)',
                        borderRadius: 8, padding: '8px 14px', fontSize: 12,
                        cursor: 'pointer', color: 'var(--mm-text)', textAlign: 'left',
                      }}>{suggestion}</button>
                    ))}
                  </div>
                </div>
              )}
              {conversation.map((msg, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, marginBottom: 16,
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 10, flexShrink: 0,
                    background: msg.role === 'ai' ? 'linear-gradient(135deg, #4361EE, #4CC9F0)' : 'var(--mm-hover-bg)',
                    display: 'grid', placeItems: 'center', fontSize: 14,
                  }}>
                    {msg.role === 'ai' ? <Sparkles size={14} color="#fff" /> : <User size={14} />}
                  </div>
                  <div style={{
                    background: msg.role === 'user' ? 'rgba(67,97,238,0.08)' : 'var(--mm-rhs-bg)',
                    borderRadius: 12, padding: '10px 14px', maxWidth: '85%',
                    fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                    border: '1px solid var(--mm-border-subtle)',
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {isProcessing && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: 10,
                    background: 'linear-gradient(135deg, #4361EE, #4CC9F0)',
                    display: 'grid', placeItems: 'center', fontSize: 14,
                  }}><Sparkles size={14} color="#fff" /></div>
                  <div style={{
                    background: 'var(--mm-rhs-bg)', borderRadius: 12, padding: '12px 16px',
                    border: '1px solid var(--mm-border-subtle)',
                    display: 'flex', gap: 4,
                  }}>
                    {[0, 1, 2].map(i => (
                      <div key={i} style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: '#4361EE', opacity: 0.5,
                        animation: `pulse 1.2s ease-in-out ${i * 0.15}s infinite`,
                      }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div style={{
              padding: '12px 16px', borderTop: '1px solid var(--mm-border)',
              display: 'flex', gap: 8,
            }}>
              <input value={askInput} onChange={e => setAskInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && askAI()}
                placeholder="Ask a question…" style={{
                  flex: 1, border: '1px solid var(--mm-border)', borderRadius: 8,
                  padding: '10px 14px', fontSize: 13, background: 'var(--mm-main-bg)',
                  color: 'var(--mm-text)', outline: 'none',
                }} />
              <button onClick={askAI} disabled={isProcessing || !askInput.trim()} style={{
                background: '#4361EE', border: 'none', borderRadius: 8,
                padding: '0 16px', color: '#fff', fontSize: 13, fontWeight: 600,
                cursor: 'pointer', opacity: isProcessing || !askInput.trim() ? 0.5 : 1,
              }}>Ask</button>
            </div>
          </div>
        )}

        {activeTab === 'drafts' && (
          <div style={{ padding: 16, textAlign: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}><PenLine size={40} style={{ opacity: 0.5 }} /></div>
            <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4, opacity: 0.7 }}>AI Message Drafts</div>
            <div style={{ fontSize: 13, opacity: 0.5, marginBottom: 20 }}>
              Describe what you want to say and AI will draft it in your tone.
            </div>
            <textarea placeholder="I need to tell the engineering team about the deadline change…" style={{
              width: '100%', border: '1px solid var(--mm-border)', borderRadius: 8,
              padding: 12, fontSize: 13, background: 'var(--mm-main-bg)',
              color: 'var(--mm-text)', outline: 'none', minHeight: 100, resize: 'vertical',
              lineHeight: 1.6, fontFamily: 'inherit',
            }} />
            <button style={{
              background: '#4361EE', border: 'none', borderRadius: 8,
              padding: '10px 24px', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', marginTop: 12,
            }}><Sparkles size={13} /> Generate Draft</button>
          </div>
        )}
      </div>
    </div>
  )
}
