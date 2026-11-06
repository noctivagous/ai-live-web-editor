
- ai live editor
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
