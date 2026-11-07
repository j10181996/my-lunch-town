CREATE TABLE `app_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`bytes` blob NOT NULL
);
--> statement-breakpoint
CREATE TABLE `live_presence` (
	`room_id` text NOT NULL,
	`member_id` text NOT NULL,
	`client_id` text NOT NULL,
	`payload` text,
	`seen_at` integer NOT NULL,
	PRIMARY KEY(`room_id`, `member_id`, `client_id`)
);
