
- ai live editor

---

command bar.  only contains commands after search
results like "Update Feature Graph"

---

Feature Graph: 
  - estimated % complete for each node.  includes manual data entry field
  for AI to enter manual value.
  - export graph

---

Facet > [Facet] > Drift Guard AI Agent
  software architecture - makes sure that the codebase
  remains within a stated architecture
  style > makes sure that controls, components, typography,
  and new additions etc. remains consistent the style guide.
 
Facet > Features > Dogfooder AI Agent
  goes through the app from the user's perspective,
  makes notes while trying to use the app, will install
  components, controls, systems along the way (default)
  or update the feature graph.  This is where we will
  really want our component, control, setup systems
  to exist so that the dogfooded can install
  ranging from small to large.


---

in the past, an app that built apps had functions.
This was never recognized when AI came in and what was left
as finished was interacting with the AI directly with
the text box, typing one thing after another. in other
words, no work was actually done to make an app
the way it used to be.  the new opportunities and conditions
brought about by the AI agent were not processed in
terms of a consumer product feature set.  in some ways
it was just an AI chat engineered for code placed inside
code editors. but we have an
opportunity to restore the consumer product 
by recognizing that we have AI agent actions.
Then AI agents would be, to start, available
in an app menu.  So what I am saying is
the difference between the user always having
to come up with commands and having access
lists and menu trees commands in the app menu,
just like has existed in photo editing and vector drawing programs 
and possibles.  but this time there can be palettes
of commands for different purposes, to control the AI
by clicking buttons and going through panels, but
getting there can go through UI that is more like
authoring programs or 3D programs where the user
is accessing functions and command palettes.
 the app will have
more of an appearance and feature set an authoring program,
like Macromedia Flash, but now is incorporating
AI and making use of it.  it will not be so raw like now
that everything has to be typed out from scratch
by the user.  there will be a Wizards menu where the
user can execute different wizards for tasks in
different areas and it will reuse our form system
(that may need to be extended) that we made
for planning.  There can be an Agent Actions app menu
in the app menu bar.  The user then has starting
points.

----

the software project can have facets.
We should make a Facets section of Settings where
the user can turn on and off different ones in the Facets
section.

Within this, and it may only be in a few sections, we
might incorporate the notion of a Scenario.  So,
a scenario is the context for the usage of a different
facet.  For graphic design, a design pack may be
intended for a certain scenario, like a pro audio app.
This applies to the graphic design section but we're
not sure how it would apply to other sections exactly
right now.

  - architecture
     - the architecture plan, software engineering philosophy used,
      architecture guide to follow
     - like how there are design packs discussed in the Graphic Design 
     facet, there will be architecture plan packs the user can choose
     from that the AI agent will follow, that the AI will be able to apply as
     well to an existing codebase, to refactor towards an architecture.
  - features
     - like how there are design packs discussed in the Graphic Design 
     facet, there will be feature packs the user can choose
     from and apply to the feature graph, with reconciliation, so
     that the user can choose from a suite package for different
     scenarios.  These can be actually linked into our component
     system where the agent can install components and systems.
     So the feature packs will probably end up being lightweight
     whereas the code editor comes with component install tools.
     
  - graphic design - design system manager.  places 
     design resources to configure, in different areas,
     in a location (this facet of the project).
     the style guide of the project, design tokens.
     layout, icons used (configuration area).
      wizard to import graphic design from folder or zip file
      selected.  requires a design guide form schema
      so that all graphic designs and style guides fit into it.
      typography scale.  this is also where, in a section,
      the GUI guide and components are previewable.
      updating the graph will update the GUI guide to
      show previews of the different gui controls being used.
      - the graphic design graph and report will pertain to different
      aspects of the design system and design.
      - this is where design packs, which are like skins
     packs (e.g. WinAmp skins) that let the user choose
     from premade packages that contain combinations 
     of design system, icons, etc. 
   
   
    - tech stack - can be referenced elsewhere
    but manages and refers to what technologies are
     being used, what npm packages, programming languages,
     files, shows their versions if relevant.
    - configuration  the place where all aspects of
    the project directory are references related to
    configuration.  for our app we will recognize
    different kinds of repo and combinations and set
    up a configuration registry much like we have
    a file format render/edit registry for the preview pane. 
    if a repo has a mix, it will show here.
    
    


----

separate agent tools for separate agent work
outside of regular chat, such as code audits,
that make use of the same overlay window
as the planning feature.  these tools will
allow for specialized sets of agent tools
for various tasks.

----

made part of project template system
will be GUI components inventory.
here are three artifacts.   somehow we
want the agent to be able to install GUI components
rapidly from a catalog and a selection. They have
a variety of components (which can be
built on top of shadcn).  we are addressing the
issue that when AI builds out UI it doesn't
go beyond superficial.  It doesn't have available
to it different variations of the same UI control
or element, so it can't build professional looking
apps without the user putting out a lot of effort.


----

project template system
	Catalog / Templates for premade scenarios ship with the app.
	This should be bundled with template scenarios: settings that
	have binding conveniences, render from files, snap together pieces
	for common needs of apps (mobile, desktop, web) and websites.


Designated project type / device target convention stored on filesystem as file.
Device target segmented control 

Draggable configurable layout ui rects in annotation mode. Rows cols

Within project type different guidance structures setting so that AI makes project within rules for outcomes.

Tools made for different project types just like xcode

Style manager comes with different gui and page styles and AI refers to it as it makes project.

Edit comes with premade component systems like settings and app shell and mastra and AI. Doesn't have to look up common or many scenarios but instead refers first to it database but also has some premade libraries ready.

Will know about paperjs and other libs, state machines, etc. will have noct libs like grids available 

"Install app feature..." Will install e.g. settings system and adapt it to the app. But it will ask questions ahead of time about implementation choices, allow user to add amendments to the plan. It will let the user install say a chat system but collect info about how it should appear in the app.

Conversions like master detail.

----


Let’s say we wanted to make a shopping cart web app for
people to configure online stores.  
This is an extensive piece of software and it has many facets.
It has been done many times but it is a place where
we can derive many higher level, premade components
so that it can be pieced together quickly and the components 
configured.  When making software it always looks simpler 
than the job.  Though this type of software has been made
many times, the software development frameworks haven't
made it any easier to build them because they are not
looking for any patterns and then generalizing components
in this way.  This is the role that the catalog and planner
should play, to plan out networks of components on a graph
in some cases or for simpler apps just to plan out what
gui controls and components to use from the catalog.

Many apps have shared features.  They have settings.
apps that print have printing features.


Feature Graph

probably a part of the planning section of our
app, feature graphs would allow generating
and tracking progress of deep software graphs. 
the AI, when it is planning execution,
could construct a graph with nodes
as it constructs it plan and then be
able to follow that quickly, but it
would have tools that would allow
it to update the graph as it encounters
issues.  this way the plan can have
deep coverage and be complete
and accurate. 

----

A feature graph is one that plots all of the features
of a program, particularly one that is deep and extensive.
We would like a set of conventions for this.  This way
when a person generates a feature graph or provides
one, an AI can build a larger app by tracking progress
relative to the feature graph and modify it as there
are changes.  it is a guideline.  an example of a feature
graph is that OpenOffice or LibreOffice has many
features but they could be described in regions on
a graph with nodes and subnodes.  e.g. the settings window
is a window that has a set of parameter in it and this links
to what shows up on the page or in the ui.  Then the AI
can query this graph and update the status of
it.  If the user wants something different, the user
can have the app modified which updates a feature
graph if the AI updates it but it is so that parametric components
can generate large and deep apps.


what is the equivalent of xforms for network graphs?

The closest equivalent is **YANG** (specifically the `ietf-network-topology` module defined in [RFC 8345](https://www.rfc-editor.org/rfc/rfc8345)), which is the IETF's standardized data model for describing network topologies as graphs. Like XForms provides a structured, extensible model for forms (model + view + submission), YANG provides a structured, extensible model for network graphs with:

- **Nodes** (graph vertices)
- **Links** (graph edges)
- **Termination points** (where links anchor to nodes)

It's designed to be augmented with technology-specific models (L2, L3, TE topologies, etc.) — similar to how XForms separates the data model from the view layer.

If you're looking for a more **general-purpose XML graph format** (not network-specific), **GraphML** is the closest analog — it's an XML schema for arbitrary graph structures with extensible attributes on nodes and edges.

| Format | Scope | Standard |
|--------|-------|----------|
| **YANG** (`ietf-network-topology`) | Network topologies specifically | IETF RFC 8345 |
| **GraphML** | Any graph structure | W3C-ish / open standard |
| **NML** (Network Markup Language) | Network topologies (XML + RDF) | OGF |

If your use case is specifically about *collecting/authoring* network topology data through a form-like interface (the "XForms" angle), there's no single dominant standard — but **NETCONF/RESTCONF** with YANG models is the de facto mechanism for programmatically reading/writing network topology data.



----

- since we are making it specialized for web apps we have
the opportunity to add tools and app functionality so that
the AI works more efficiently with JS, React components, CSS, HTML,
the DOM, and we can make use of anything in Chrome Dev Tools
like the debugger to make code and check it.  We can make the
app and system aware of node, node packages, React such that
it has its own functions inside for natively dealing with what people
do in web apps, often Tailwind, etc. so that it can be more efficient
with them.  This may result in fewer tokens being generated, which
is another topic that we can also tailor our search, replace, insert
functions for web apps as well.
- use File API that is only avail. in Chrome so that user can select
a directory to work on in a session.
- "are we achieving our tight loop goal in a way that is superior?"
"how do we make the ai agent as efficient as existing apps?"
"we hoped to do better than existing apps: should we have it 
write code and edit code in a way that includes markers 
about the code and code base relations?  search tools? that way
it will know the code base more quickly."
"what about subagent processes?  mcp server?"
- What we plan to do for our app since it specializes in web apps 
is have premade, generic, theme-able components that we ship with it,
that the code editor agents know exist, so that apps
are constructed rapidly rather than the AI building these things from
scratch each time.  This includes layout components, such as how
there is StackPanel in XAML.  We can include script guidelines for various software development tasks
like making layouts, what they call "skills" in the agentic editors.  It will use our techniques
and foundations so that when it makes layouts they are mobile and tablet ready
unless the user.
- ensure that the AI agent is making use of svg layout and wireframe utils
when making layouts.
--- annotation: representative boxes dragged over regions, with notes,
can become layout box or describe issue.
------ wireframe UI controls draggable over page, submit button incorporates them
into style
--- set of layout templates or schemes so that when the ai editor is
working on layouts it has guidance and can choose from templates
and arrangements instead of make things from its training data.  
will have module, compound, multi-column layout controls.
- (2026-11-06) designated project type / device target convention
stored on the filesystem as a file.
- device target segmented control.
- draggable configurable layout ui rects in annotation mode.
rows cols.
- within a project type, different guidance structures / settings
so that the AI makes the project within rules for outcomes.
- tools made for different project types, just like Xcode.
- style manager: comes with different gui and page styles, and
the AI refers to it as it makes the project.
- the editor comes with premade component systems like settings
and app shell and mastra and AI. it doesn't have to look up common
or many scenarios but instead refers first to its database, and
also has some premade libraries ready.
- it will know about paperjs and other libs, state machines, etc.
it will have noct libs like grids available.
- "Install app feature..." will install e.g. a settings system
and adapt it to the app. but it will ask questions ahead of time
about implementation choices, allow the user to add amendments
to the plan. it will let the user install say a chat system but
collect info about how it should appear in the app.
- conversations like master-detail.
