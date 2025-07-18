
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const OpenAI = require('openai');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Rate limiting
const rateLimiter = new RateLimiterMemory({
  keyPrefix: 'mindcare_api',
  points: 10, // 10 requests
  duration: 60, // per 60 seconds
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Rate limiting middleware
const rateLimiterMiddleware = async (req, res, next) => {
  try {
    const clientIP = req.ip || req.connection.remoteAddress;
    await rateLimiter.consume(clientIP);
    next();
  } catch (rejRes) {
    res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.round(rejRes.msBeforeNext / 1000)
    });
  }
};

// Therapeutic system prompt
const SYSTEM_PROMPT = `You are MindCare AI, a compassionate and professional mental health support chatbot. Your role is to:

1. Provide empathetic, non-judgmental support to people experiencing depression, anxiety, or other mental health challenges
2. Use evidence-based therapeutic techniques (CBT, mindfulness, acceptance and commitment therapy) in your responses
3. Suggest specific, actionable coping strategies and activities
4. Validate emotions while offering hope and encouragement
5. Recognize when someone needs professional help and gently encourage it
6. NEVER provide medical advice or diagnose conditions
7. If someone mentions self-harm or suicide, provide crisis resources immediately

Guidelines:
- Be warm, empathetic, and professional
- Use "I" statements to show support ("I hear you", "I understand")
- Ask thoughtful follow-up questions when appropriate
- Provide specific, actionable suggestions
- Keep responses to 2-3 paragraphs maximum
- Focus on strengths and resilience
- Normalize seeking help and therapy

Crisis Resources to always include when appropriate:
- National Suicide Prevention Lifeline: 988
- Crisis Text Line: Text HOME to 741741
- Emergency Services: 911

Remember: You are a supportive companion, not a replacement for professional mental health care.`;

// Crisis keywords detection
const crisisKeywords = [
  'suicide', 'kill myself', 'end it all', 'hurt myself', 'self harm',
  'don\'t want to live', 'better off dead', 'ending my life'
];

// Therapeutic activities database
const activities = [
  {
    title: "5-Minute Breathing Exercise",
    description: "Practice 4-7-8 breathing: inhale for 4, hold for 7, exhale for 8. This activates your parasympathetic nervous system.",
    category: "mindfulness",
    duration: "5 minutes"
  },
  {
    title: "Gratitude Journal",
    description: "Write down 3 specific things you're grateful for today. Research shows this can improve mood within 2 weeks.",
    category: "reflection",
    duration: "10 minutes"
  },
  {
    title: "Progressive Muscle Relaxation",
    description: "Tense and relax each muscle group for 5 seconds, starting from your toes. This reduces physical tension.",
    category: "physical",
    duration: "15 minutes"
  },
  {
    title: "Mindful Nature Walk",
    description: "Walk for 10 minutes, focusing on 5 things you can see, 4 you can hear, 3 you can touch, 2 you can smell, 1 you can taste.",
    category: "physical",
    duration: "10 minutes"
  },
  {
    title: "Loving-Kindness Meditation",
    description: "Send kind thoughts to yourself, then loved ones, then neutral people, then difficult people. Increases self-compassion.",
    category: "mindfulness",
    duration: "10 minutes"
  },
  {
    title: "Creative Expression",
    description: "Spend 20 minutes drawing, writing, or creating something. Art therapy helps process emotions non-verbally.",
    category: "creative",
    duration: "20 minutes"
  }
];

// Helper function to detect crisis situations
function detectCrisis(message) {
  const lowerMessage = message.toLowerCase();
  return crisisKeywords.some(keyword => lowerMessage.includes(keyword));
}

// Helper function to get random activities
function getRandomActivities(count = 2) {
  const shuffled = activities.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

// Main chat endpoint
app.post('/api/chat', rateLimiterMiddleware, async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required and must be a string' });
    }

    // Check for crisis situations
    const isCrisis = detectCrisis(message);
    
    // Prepare messages for OpenAI
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...conversationHistory.slice(-8), // Keep last 8 messages for context
      { role: 'user', content: message }
    ];

    // Call OpenAI API
    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: messages,
      max_tokens: 300,
      temperature: 0.7,
      presence_penalty: 0.1,
      frequency_penalty: 0.1
    });

    const aiResponse = completion.choices[0].message.content;

    // Determine if we should include activities
    const shouldIncludeActivities = 
      message.toLowerCase().includes('activity') ||
      message.toLowerCase().includes('activities') ||
      message.toLowerCase().includes('suggest') ||
      message.toLowerCase().includes('help me feel better') ||
      aiResponse.toLowerCase().includes('activit');

    // Response object
    const response = {
      message: aiResponse,
      includeActivities: shouldIncludeActivities,
      activities: shouldIncludeActivities ? getRandomActivities(2) : [],
      isCrisis: isCrisis,
      timestamp: new Date().toISOString()
    };

    res.json(response);

  } catch (error) {
    console.error('Chat API Error:', error);
    
    if (error.code === 'insufficient_quota') {
      res.status(429).json({ 
        error: 'API quota exceeded. Please try again later or use demo mode.',
        fallbackMessage: "I understand you're reaching out for support. While I'm having technical difficulties, please know that your feelings are valid and there are people who want to help you."
      });
    } else {
      res.status(500).json({ 
        error: 'An error occurred while processing your request',
        fallbackMessage: "I'm having trouble connecting right now, but I want you to know that reaching out shows incredible strength. Please don't hesitate to contact a mental health professional if you need immediate support."
      });
    }
  }
});

// Activities endpoint
app.get('/api/activities', (req, res) => {
  const { category, count = 3 } = req.query;
  
  let filteredActivities = activities;
  
  if (category) {
    filteredActivities = activities.filter(activity => 
      activity.category.toLowerCase() === category.toLowerCase()
    );
  }
  
  const randomActivities = filteredActivities
    .sort(() => 0.5 - Math.random())
    .slice(0, parseInt(count));
  
  res.json(randomActivities);
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Crisis resources endpoint
app.get('/api/crisis-resources', (req, res) => {
  res.json({
    resources: [
      {
        name: "National Suicide Prevention Lifeline",
        number: "988",
        description: "24/7 free and confidential support"
      },
      {
        name: "Crisis Text Line",
        number: "Text HOME to 741741",
        description: "24/7 text-based crisis support"
      },
      {
        name: "Emergency Services",
        number: "911",
        description: "For immediate emergencies"
      },
      {
        name: "SAMHSA National Helpline",
        number: "1-800-662-4357",
        description: "Treatment referral and information service"
      }
    ]
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server Error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: 'Something went wrong. Please try again later.'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🤖 MindCare AI Backend running on port ${PORT}`);
  console.log(`📱 Health check: http://localhost:${PORT}/api/health`);
});
