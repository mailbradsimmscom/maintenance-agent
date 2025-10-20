FIRST IT IS IMPORTANT TO READ CLAUDE.MD, SECOND ALTHOUGH WE WILL BE INTERFACING WITH CORE CODE THIS SHOULD BE AN ENTIRELY NEW STACK OF CODE.

## Maintenance Discovery Agent - North Star Brief

### Vision
An intelligent, proactive maintenance discovery system that goes beyond manual extraction to actively hunt for everything that needs maintenance on a vessel - including hidden dependencies and real-world requirements that manuals don't mention.

### Core Complexity Warning
The current system (80+ documents, DIP pipeline, chat, LLM integration) is already complex. This maintenance agent adds another layer of complexity through:
- Continuous monitoring of multiple data sources
- Inference of hidden system dependencies  
- Learning from user decisions per system
- Real-world knowledge integration
- Future real-time data fusion (SignalK)

### The Agent's Mission

**Primary Goal**: Ensure nothing on the vessel fails due to unknown or forgotten maintenance

**Dual Operating Modes**:
1. **Extract**: Find maintenance tasks in existing documentation
2. **Discover**: Proactively hunt for maintenance not in any manual

### Key Capabilities

#### 1. Active System Monitoring
- Watches for new systems added to database
- Immediately researches each new system
- Suggests related systems that might need tracking

#### 2. Dependency Inference
- Understands that systems have hidden dependencies
- Example: AC unit → requires sea strainer → needs cleaning
- Identifies supporting components manuals assume you know about

#### 3. Real-World Knowledge Integration
- Searches beyond manuals for actual failure patterns
- Incorporates community knowledge, service bulletins
- Adjusts for environmental conditions (tropical, blue water, coastal)

#### 4. Continuous Learning
- Learns from approval/rejection per system (not globally)
- Builds confidence scores based on user decisions
- Remembers what's been suggested to prevent re-presentation

#### 5. Parts & Spares Intelligence
- Extracts explicit part numbers from documentation
- Infers common consumables needed
- Links maintenance tasks to required inventory

### Technical Architecture

#### Processing Pipeline
```
New System Added / Document Uploaded
    ↓
Extract from Manuals + Search Real World
    ↓
Infer Dependencies + Check for Related Systems
    ↓
Queue for Review (with confidence scores)
    ↓
Learn from Decision + Update Patterns
    ↓
Production Schedule + Parts Tracking
```

#### Data Requirements
- Track processed chunks (prevent re-extraction)
- Store task fingerprints (prevent duplicates)
- Maintain learning patterns per system
- Track source attribution
- Build data wishlist for SignalK integration

### Complexity Management

#### Why This Is More Complex Than Current System
1. **Stateful Processing**: Must remember what it's found/suggested
2. **Multi-Source Integration**: Manuals + web + inference + future sensors
3. **Temporal Awareness**: Knows when to re-check for updates
4. **Relationship Mapping**: Understands system dependencies
5. **Continuous Operation**: Always watching, not just on-demand

#### Risk Mitigation
- Build incrementally - start with manual extraction
- Add learning layer after basic pipeline works
- Integrate real-world sources gradually
- Comprehensive logging for debugging
- Clear source attribution for user trust
- Rollback capability for bad decisions

### Success Metrics
1. **Discovery Rate**: Finding maintenance tasks not in manuals
2. **Acceptance Rate**: % of suggestions approved by user
3. **Failure Prevention**: Catching issues before they occur
4. **Coverage**: % of systems with maintenance schedules
5. **Learning Efficiency**: Reduction in rejected suggestions over time

### Future Integration Points
- **SignalK**: Real-time usage data for condition-based maintenance
- **Calendar**: Scheduling and conflict management
- **Notifications**: Alerts for upcoming maintenance
- **Inventory**: Auto-ordering when parts run low

### Critical Design Principles
1. **Never miss hidden maintenance** (like AC sea strainers)
2. **Learn and improve** from every user decision
3. **Attribute everything** to sources for trust
4. **Prevent duplicate work** through fingerprinting
5. **Stay proactive** - hunt, don't wait

### Implementation Priority
1. Basic extraction from existing documents
2. Approval workflow UI
3. Learning system (per-system patterns)
4. Real-world search integration
5. Dependency inference engine
6. Continuous monitoring system

---

**Note**: This system's complexity comes from its autonomous, continuous nature and multi-source integration. Unlike the current request-response pattern, this agent is always working, learning, and discovering. Plan for substantial testing and monitoring infrastructure.

### Microservice Architecture from Day 1

**Maintenance Agent Service** (Cloud from start)
- Independent Node.js service
- Own repo/deployment
- Shares Supabase/Pinecone with main system
- API endpoints for future integration
- Job queue pattern for processing

**Database as Integration Layer**
- No direct code dependencies
- Communicates through Supabase tables
- Main system reads agent's findings
- Agent reads system/document updates

**Future Migration Path**
```
Current: [Main System Local] ← Supabase → [Agent Cloud]
Future:  [Main System Cloud] ← Supabase → [Agent Cloud]
                    ↓            ↓            ↓
                    └── Direct API calls ──┘
```

# We are starting with Render, architect for AWS migration later