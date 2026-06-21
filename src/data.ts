export type Marker = { name: string; value: number; unit: string; status: 'good' | 'watch' | 'high'; delta: string; range: string; points: { date: string; value: number }[] }

export const markers: Marker[] = [
  { name: 'Vitamin D', value: 42, unit: 'ng/mL', status: 'good', delta: '+18%', range: '30–100', points: [{date:'Jul',value:22},{date:'Sep',value:27},{date:'Nov',value:31},{date:'Jan',value:35},{date:'Mar',value:39},{date:'Jun',value:42}] },
  { name: 'HbA1c', value: 5.4, unit: '%', status: 'good', delta: '−0.3', range: '4.0–5.6', points: [{date:'Jul',value:5.8},{date:'Sep',value:5.7},{date:'Nov',value:5.7},{date:'Jan',value:5.6},{date:'Mar',value:5.5},{date:'Jun',value:5.4}] },
  { name: 'Ferritin', value: 24, unit: 'ng/mL', status: 'watch', delta: '−8%', range: '30–150', points: [{date:'Jul',value:34},{date:'Sep',value:31},{date:'Nov',value:29},{date:'Jan',value:27},{date:'Mar',value:25},{date:'Jun',value:24}] },
  { name: 'LDL Cholesterol', value: 118, unit: 'mg/dL', status: 'watch', delta: '+6%', range: '<100', points: [{date:'Jul',value:104},{date:'Sep',value:106},{date:'Nov',value:109},{date:'Jan',value:111},{date:'Mar',value:115},{date:'Jun',value:118}] },
]

export const timeline = [
  { date: '18 Jun', year: '2026', type: 'lab', title: 'Comprehensive blood panel', meta: 'Apollo Diagnostics · 42 biomarkers', detail: 'Vitamin D reached optimal range. Ferritin remains below target.', tags: ['Vitamin D 42', 'Ferritin 24', 'HbA1c 5.4'] },
  { date: '02 Jun', year: '2026', type: 'symptom', title: 'Energy & sleep check-in', meta: 'Weekly reflection', detail: 'Energy improved to 8/10; sleep averaging 7h 24m.', tags: ['Energy 8/10', 'Sleep 7.4h'] },
  { date: '12 May', year: '2026', type: 'visit', title: 'Annual physician visit', meta: 'Dr. A. Mehta · Internal medicine', detail: 'Continue Vitamin D. Repeat iron studies in 8–12 weeks.', tags: ['Follow-up due', 'No new diagnosis'] },
  { date: '04 Apr', year: '2026', type: 'intervention', title: 'Started strength training', meta: 'Lifestyle intervention · 3× weekly', detail: 'Compound lifts and progressive overload. Baseline weight: 72.4 kg.', tags: ['Active', 'Week 11'] },
  { date: '18 Mar', year: '2026', type: 'medication', title: 'Vitamin D3 adjusted', meta: 'Supplement · 2,000 IU daily', detail: 'Dose increased from 1,000 IU after March panel.', tags: ['Active', 'Adherence 92%'] },
]

export const insights = [
  { tone: 'positive', eyebrow: 'POSITIVE TREND', title: 'Vitamin D is responding well', text: 'Levels rose 91% since supplementation began and are now in the optimal range.', action: 'View relationship' },
  { tone: 'warning', eyebrow: 'NEEDS ATTENTION', title: 'Ferritin is trending downward', text: 'Three consecutive declines. Your physician recommended repeat iron studies by July 31.', action: 'Review follow-up' },
  { tone: 'neutral', eyebrow: 'PATTERN FOUND', title: 'Sleep and energy are moving together', text: 'On weeks with 7+ hours of sleep, your reported energy is 1.6 points higher on average.', action: 'Explore pattern' },
]

export const nav = ['Overview', 'Care tracks', 'Medications', 'Biomarkers', 'Nutrition', 'Timeline', 'Documents', 'Doctor prep']
