'use client';

import { useState } from 'react';
import { HabitItem } from '../../lib/types';
import { initUserData } from '../../lib/store';

const DEFAULT_GRIND: HabitItem[] = [
  { id: 'g1', name: 'Deep Work', emoji: '💻', type: 'grind', valueType: 'duration', earnRate: 0.25 },
  { id: 'g2', name: 'Workout', emoji: '🏋️', type: 'grind', valueType: 'duration', earnRate: 0.5 },
  { id: 'g3', name: 'Cook / Chores', emoji: '🍳', type: 'grind', valueType: 'counter', earnRate: 20 },
  { id: 'g4', name: 'Study / Reading', emoji: '📚', type: 'grind', valueType: 'duration', earnRate: 0.25 },
  { id: 'g5', name: 'Clean House', emoji: '🧹', type: 'grind', valueType: 'duration', earnRate: 0.5 },
  { id: 'g6', name: 'Side Project', emoji: '🚀', type: 'grind', valueType: 'duration', earnRate: 0.3 },
  { id: 'g7', name: 'Meditation', emoji: '🧘', type: 'grind', valueType: 'duration', earnRate: 1.0 },
  { id: 'g8', name: 'Run / Cardio', emoji: '🏃', type: 'grind', valueType: 'duration', earnRate: 0.5 },
  { id: 'g9', name: 'Grocery Shopping', emoji: '🛒', type: 'grind', valueType: 'counter', earnRate: 30 },
  { id: 'g10', name: 'Admin / Emails', emoji: '📧', type: 'grind', valueType: 'duration', earnRate: 0.2 },
];

const DEFAULT_GLOW: HabitItem[] = [
  { id: 'gl1', name: 'PS5 / Gaming', emoji: '🎮', type: 'glow', valueType: 'duration', costRate: 1.0 },
  { id: 'gl2', name: 'Netflix / TV', emoji: '🍿', type: 'glow', valueType: 'duration', costRate: 1.0 },
  { id: 'gl3', name: 'Doomscrolling', emoji: '📱', type: 'glow', valueType: 'duration', costRate: 1.5 },
  { id: 'gl4', name: 'YouTube Rabbit Hole', emoji: '📺', type: 'glow', valueType: 'duration', costRate: 1.2 },
  { id: 'gl5', name: 'Hangout with Friends', emoji: '🍻', type: 'glow', valueType: 'duration', costRate: 0.5 },
  { id: 'gl6', name: 'Nap', emoji: '😴', type: 'glow', valueType: 'duration', costRate: 0.8 },
  { id: 'gl7', name: 'Takeout / Junk Food', emoji: '🍔', type: 'glow', valueType: 'counter', costRate: 60 },
  { id: 'gl8', name: 'Online Shopping', emoji: '🛍️', type: 'glow', valueType: 'duration', costRate: 2.0 },
  { id: 'gl9', name: 'Listening to Music', emoji: '🎧', type: 'glow', valueType: 'duration', costRate: 0.2 },
  { id: 'gl10', name: 'Doing Absolutely Nothing', emoji: '🦥', type: 'glow', valueType: 'duration', costRate: 1.0 },
];

const EMOJI_PRESETS_GRIND = ['✨', '💻', '🏋️', '📚', '🧹', '🚀', '🧘', '🏃', '✍️', '🎯', '🔧'];
const EMOJI_PRESETS_GLOW = ['✨', '🎮', '🍿', '🏀', '🎧', '😴', '🍻', '🛹', '🎨', '🚗', '🦥'];

export default function Onboarding() {
  const [step, setStep] = useState(1);
  const [grindOptions, setGrindOptions] = useState<HabitItem[]>(DEFAULT_GRIND);
  const [glowOptions, setGlowOptions] = useState<HabitItem[]>(DEFAULT_GLOW);
  
  const [selectedGrind, setSelectedGrind] = useState<string[]>([]);
  const [selectedGlow, setSelectedGlow] = useState<string[]>([]);

  const [customName, setCustomName] = useState('');
  const [customEmoji, setCustomEmoji] = useState('✨');

  const handleComplete = () => {
    const finalHabits: HabitItem[] = [
      ...grindOptions.filter(h => selectedGrind.includes(h.id)),
      ...glowOptions.filter(h => selectedGlow.includes(h.id))
    ];

    // A typed-but-not-added custom glow shouldn't be lost on Finish
    if (customName.trim()) {
      finalHabits.push({
        id: `custom_${Date.now()}`,
        name: customName.trim(),
        emoji: customEmoji,
        type: 'glow',
        valueType: 'duration',
        costRate: 1.0,
      });
    }

    if (finalHabits.filter(h => h.type === 'grind').length === 0) finalHabits.push(DEFAULT_GRIND[0]);
    if (finalHabits.filter(h => h.type === 'glow').length === 0) finalHabits.push(DEFAULT_GLOW[0]);

    const data = initUserData(finalHabits);
    data.onboardingComplete = true;
    localStorage.setItem('getdone_data_v2', JSON.stringify(data));
    window.location.href = '/';
  };

  const toggleSelection = (id: string, type: 'grind' | 'glow') => {
    if (type === 'grind') {
      setSelectedGrind(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    } else {
      setSelectedGlow(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
    }
  };

  const addCustom = (type: 'grind' | 'glow') => {
    if (!customName.trim()) return;
    const newId = `custom_${Date.now()}`;
    const newItem: HabitItem = {
      id: newId,
      name: customName,
      emoji: customEmoji,
      type: type,
      valueType: 'duration',
      earnRate: type === 'grind' ? 0.25 : undefined,
      costRate: type === 'glow' ? 1.0 : undefined
    };
    
    if (type === 'grind') {
      setGrindOptions(prev => [...prev, newItem]);
      setSelectedGrind(prev => [...prev, newId]);
    } else {
      setGlowOptions(prev => [...prev, newItem]);
      setSelectedGlow(prev => [...prev, newId]);
    }
    setCustomName('');
    setCustomEmoji('✨');
  };

  // Keep list order stable while toggling — reordering makes the list jump under the user's finger

  return (
    <main className="container" style={{ justifyContent: 'center', alignItems: 'center', textAlign: 'center', minHeight: '100vh' }}>
      
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', animation: 'slideUpFade 0.5s ease' }}>
          <h1 className="logo" style={{ fontSize: '3rem' }}>GetDone.</h1>
          <p style={{ fontSize: '1.2rem', color: 'var(--text-muted)' }}>
            Welcome to the new time economy.<br/><br/>
            You don't grind just to work.<br/>
            You grind to <b>earn your time.</b>
          </p>
          <button 
            onClick={() => setStep(2)}
            style={{ padding: '1rem 2rem', background: 'var(--text-main)', color: 'var(--bg)', borderRadius: 'var(--radius-full)', fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer', border: 'none' }}
          >
            Let's build your routine
          </button>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'slideUpFade 0.5s ease', width: '100%' }}>
          <h2>What is your <span style={{ color: 'var(--grind-color)' }}>Grind</span>?</h2>
          <p style={{ color: 'var(--text-muted)' }}>Select the hard things that earn you time.</p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', textAlign: 'left', maxHeight: '50vh', overflowY: 'auto', paddingRight: '10px' }}>
            {grindOptions.map(h => (
              <div 
                key={h.id} 
                onClick={() => toggleSelection(h.id, 'grind')}
                style={{ 
                  padding: '1rem', 
                  background: selectedGrind.includes(h.id) ? 'var(--grind-bg)' : 'var(--bg-surface)', 
                  border: `1px solid ${selectedGrind.includes(h.id) ? 'var(--grind-color)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 'var(--radius-md)',
                  display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'var(--transition)'
                }}
              >
                <span style={{ fontSize: '1.5rem' }}>{h.emoji}</span>
                <span style={{ fontWeight: 'bold' }}>{h.name}</span>
              </div>
            ))}
            
            {/* Custom Add */}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <select
                value={customEmoji}
                onChange={e => setCustomEmoji(e.target.value)}
                style={{ width: '3.5rem', textAlign: 'center', fontSize: '1.25rem', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: 'var(--radius-sm)', appearance: 'none', cursor: 'pointer' }}
              >
                {EMOJI_PRESETS_GRIND.map(em => <option key={em} value={em}>{em}</option>)}
              </select>
              <input 
                type="text" 
                placeholder="Add custom grind..." 
                value={customName} 
                onChange={e => setCustomName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustom('grind')}
                style={{ flex: 1, padding: '0.75rem', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: 'var(--radius-sm)' }}
              />
              <button 
                onClick={() => addCustom('grind')}
                style={{ padding: '0 1rem', background: 'var(--grind-color)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 'bold' }}
              >
                Add
              </button>
            </div>
          </div>

          <button
            onClick={() => { if (customName.trim()) addCustom('grind'); setStep(3); }}
            style={{ padding: '1rem 2rem', background: 'var(--grind-color)', color: 'white', borderRadius: 'var(--radius-full)', fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer', border: 'none', marginTop: '1rem' }}
          >
            Next ({selectedGrind.length} selected)
          </button>
        </div>
      )}

      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', animation: 'slideUpFade 0.5s ease', width: '100%' }}>
          <h2>What is your <span style={{ color: 'var(--glow-color)' }}>Glow</span>?</h2>
          <p style={{ color: 'var(--text-muted)' }}>Select the ways you want to unwind.</p>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', textAlign: 'left', maxHeight: '50vh', overflowY: 'auto', paddingRight: '10px' }}>
            {glowOptions.map(h => (
              <div 
                key={h.id} 
                onClick={() => toggleSelection(h.id, 'glow')}
                style={{ 
                  padding: '1rem', 
                  background: selectedGlow.includes(h.id) ? 'var(--glow-bg)' : 'var(--bg-surface)', 
                  border: `1px solid ${selectedGlow.includes(h.id) ? 'var(--glow-color)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: 'var(--radius-md)',
                  display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer', transition: 'var(--transition)'
                }}
              >
                <span style={{ fontSize: '1.5rem' }}>{h.emoji}</span>
                <span style={{ fontWeight: 'bold' }}>{h.name}</span>
              </div>
            ))}
            
            {/* Custom Add */}
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
              <select
                value={customEmoji}
                onChange={e => setCustomEmoji(e.target.value)}
                style={{ width: '3.5rem', textAlign: 'center', fontSize: '1.25rem', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: 'var(--radius-sm)', appearance: 'none', cursor: 'pointer' }}
              >
                {EMOJI_PRESETS_GLOW.map(em => <option key={em} value={em}>{em}</option>)}
              </select>
              <input 
                type="text" 
                placeholder="Add custom glow..." 
                value={customName} 
                onChange={e => setCustomName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCustom('glow')}
                style={{ flex: 1, padding: '0.75rem', background: 'var(--bg-surface)', border: '1px solid rgba(255,255,255,0.1)', color: 'white', borderRadius: 'var(--radius-sm)' }}
              />
              <button 
                onClick={() => addCustom('glow')}
                style={{ padding: '0 1rem', background: 'var(--glow-color)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', fontWeight: 'bold' }}
              >
                Add
              </button>
            </div>
          </div>

          <button 
            onClick={handleComplete}
            style={{ padding: '1rem 2rem', background: 'var(--glow-color)', color: 'white', borderRadius: 'var(--radius-full)', fontWeight: 'bold', fontSize: '1.1rem', cursor: 'pointer', border: 'none', marginTop: '1rem' }}
          >
            Finish ({selectedGlow.length} selected)
          </button>
        </div>
      )}

    </main>
  );
}
