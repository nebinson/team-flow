import type { Conversation } from '../types';

export const seedConversations: Conversation[] = [
  { id: 'design', name: 'Design & site team', initials: 'DS', color: 'lavender', role: '8 members · 3 online', online: true, time: '10:42', unread: 3, pinned: true, group: true, messages: [
    { id: 1, sender: 'Ananya', text: 'Morning everyone! I’ve shared the revised lobby layout. The new flow feels much calmer ✨', time: '10:18', sentiment: 'positive' },
    { id: 2, sender: 'Karan', text: 'Love where this is going. The warmer wood palette works nicely with the stone.', time: '10:21', sentiment: 'positive' },
    { id: 3, sender: 'You', text: 'Agreed. I’ll update the material board and send it over before lunch.', time: '10:24', own: true },
    { id: 4, sender: 'Riya', text: 'Quick check — are we keeping the reception desk at 2400mm?', time: '10:37', sentiment: 'neutral' },
    { id: 5, sender: 'Ananya', text: 'Yes, 2400mm is confirmed. I added the dimension to the latest plan.', time: '10:42', sentiment: 'positive' },
  ] },
  { id: 'ananya', name: 'Ananya Rao', initials: 'AR', color: 'peach', role: 'Project designer', online: true, time: '9:56', pinned: true, messages: [
    { id: 1, sender: 'Ananya', text: 'Could you take a look at the client notes when you have a moment?', time: '9:43', sentiment: 'neutral' },
    { id: 2, sender: 'You', text: 'Of course — I’ll review them before our 11:30 sync.', time: '9:56', own: true },
  ] },
  { id: 'site', name: 'Chennai site update', initials: 'CS', color: 'mint', role: '6 members · 2 online', online: false, time: '9:12', unread: 1, group: true, messages: [
    { id: 1, sender: 'Vikram', text: 'Electrical rough-in is complete on level two. Ready for inspection.', time: '9:12', sentiment: 'positive' },
  ] },
  { id: 'arjun', name: 'Arjun Menon', initials: 'AM', color: 'blue', role: 'Operations', online: false, time: 'Yesterday', messages: [
    { id: 1, sender: 'You', text: 'Thanks for sorting the delivery schedule.', time: '16:32', own: true },
    { id: 2, sender: 'Arjun', text: 'Anytime! I’ll share the updated tracker tomorrow.', time: '16:35', sentiment: 'positive' },
  ] },
  { id: 'leadership', name: 'Studio leadership', initials: 'SL', color: 'rose', role: '5 members', online: false, time: 'Mon', group: true, messages: [
    { id: 1, sender: 'Meera', text: 'The quarterly review is moved to Thursday at 3 PM.', time: '15:10', sentiment: 'neutral' },
  ] },
];

export const conversationSummary = 'The team is refining the lobby layout and material palette. The 2400mm reception desk dimension is confirmed, and the material board will be updated before lunch.';
