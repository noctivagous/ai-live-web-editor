import React, { useState } from 'react'
import { Button } from './src/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from './src/components/ui/card'
import { Checkbox } from './src/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './src/components/ui/dialog'
import { Input } from './src/components/ui/input'
import { Label } from './src/components/ui/label'
import { Separator } from './src/components/ui/separator'
import { Switch } from './src/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './src/components/ui/tabs'
import { Textarea } from './src/components/ui/textarea'

function ProfileDialog() {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Edit profile</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit profile</DialogTitle>
          <DialogDescription>Change your name and email, then save.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-2">
            <Label htmlFor="profile-name">Name</Label>
            <Input id="profile-name" defaultValue="Ada Lovelace" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="profile-email">Email</Label>
            <Input id="profile-email" type="email" defaultValue="ada@example.com" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function App() {
  const [notify, setNotify] = useState(true)
  const [name, setName] = useState('Untitled project')
  return (
    <div className="mx-auto max-w-2xl p-6">
      <Card>
        <CardHeader>
          <CardTitle>Project settings</CardTitle>
          <CardDescription>Stock shadcn components, copied into this project.</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="general">
            <TabsList>
              <TabsTrigger value="general">General</TabsTrigger>
              <TabsTrigger value="advanced">Advanced</TabsTrigger>
            </TabsList>
            <TabsContent value="general" className="pt-4">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="project-name">Project name</Label>
                  <Input
                    id="project-name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="project-notes">Notes</Label>
                  <Textarea id="project-notes" placeholder="What is this project for?" />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="notify">Email notifications</Label>
                  <Switch id="notify" checked={notify} onCheckedChange={setNotify} />
                </div>
                <div className="flex items-center gap-2">
                  <Checkbox id="public" />
                  <Label htmlFor="public">Make this project public</Label>
                </div>
              </div>
            </TabsContent>
            <TabsContent value="advanced" className="pt-4">
              <p className="text-sm text-muted-foreground">
                Current project name: {name}. Notifications are {notify ? 'on' : 'off'}.
              </p>
            </TabsContent>
          </Tabs>
          <Separator className="my-6" />
          <div className="flex flex-wrap items-center gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="link">Link</Button>
            <Button size="sm">Small</Button>
            <Button size="lg">Large</Button>
          </div>
        </CardContent>
        <CardFooter className="justify-between">
          <span className="text-sm text-muted-foreground">shadcn pilot</span>
          <ProfileDialog />
        </CardFooter>
      </Card>
    </div>
  )
}
