PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'teacher',
      created_at TEXT NOT NULL
    );
INSERT INTO users VALUES(1,'teacher@ctquest.local','0f988de00e7f3eb574ffcef8998251b32563d60aa3a19963b503d1537f488acb22b8afe8b8ef052a7e476031899b804193fd7e54c893ed31cb45ac2966d60856','teacher','2026-09-27T01:59:55.154Z');
CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      join_code TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      selection_mode TEXT NOT NULL DEFAULT 'ALL',
      duration_minutes INTEGER,
      start_at TEXT,
      end_at TEXT,
      created_by INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
INSERT INTO events VALUES(1,'CT Quest Demo Event','DEMO123','active','ALL',45,NULL,NULL,1,'2026-09-27T01:59:55.162Z');
INSERT INTO events VALUES(2,'P6 Round','P6RND','active','P6',20,NULL,NULL,1,'2026-09-27T02:00:01.904Z');
CREATE TABLE event_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      question_id TEXT NOT NULL,
      question_order INTEGER NOT NULL,
      question_json TEXT NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
INSERT INTO event_questions VALUES(1,1,'P5-01',0,'{"id":"P5-01","level":"P5","topic":"Sequencing","qType":"Order / process","details":"Tests reasoning about step order and constraints (can’t close box before inserting items).","title":"Packing order","points":3,"prompt":"A robot packs a snack box.\n\nSteps available:\n1) Put the sandwich into the box\n2) Close the box\n3) Put the note into the box\n\nWhich order always works?","options":["1, 2, 3","3, 1, 2","2, 1, 3","1, 3, 2"],"answerIndex":3}');
INSERT INTO event_questions VALUES(2,1,'P5-02',1,'{"id":"P5-02","level":"P5","topic":"Patterns","qType":"Next in sequence","details":"Finds a repeating pattern and predicts a later position.","title":"Sticker pattern","points":3,"prompt":"A sticker machine prints this pattern repeatedly:\n\nCircle, Circle, Square, Circle, Circle, Square, ...\n\nWhat is the 9th sticker?","options":["Circle","Square","Triangle","It cannot be known"],"answerIndex":1}');
INSERT INTO event_questions VALUES(3,1,'P5-03',2,'{"id":"P5-03","level":"P5","topic":"Logic","qType":"If rule","details":"Applies a simple if/otherwise rule carefully.","title":"Ticket rule","points":3,"prompt":"A game gives a ticket based on the number you roll:\nIf the number is 1 or 2, you get a BLUE ticket.\nOtherwise, you get a RED ticket.\n\nYou roll a 4. What ticket do you get?","options":["BLUE","RED","Both","None"],"answerIndex":1}');
INSERT INTO event_questions VALUES(4,1,'P5-04',3,'{"id":"P5-04","level":"P5","topic":"Spatial reasoning","qType":"Rotation","details":"Mentally rotates an object by 90° steps.","title":"Turn the arrow","points":3,"prompt":"An arrow points UP. You turn it right (clockwise) twice.\n\nWhere does it point now?","options":["Up","Down","Left","Right"],"answerIndex":1}');
INSERT INTO event_questions VALUES(5,1,'P5-05',4,'{"id":"P5-05","level":"P5","topic":"Information","qType":"Counting states","details":"Counts how many outcomes exist for multiple ON/OFF choices.","title":"Light switches","points":3,"prompt":"You have 3 light switches. Each switch can be ON or OFF.\n\nHow many different switch patterns are possible?","options":["3","6","8","9"],"answerIndex":2}');
INSERT INTO event_questions VALUES(6,1,'P6-01',5,'{"id":"P6-01","level":"P6","topic":"Grids / paths","qType":"Shortest path","details":"Finds a shortest path length on a grid while avoiding obstacles.","title":"Shortest safe walk","points":4,"prompt":"You are at S and want to reach T.\nYou can move up/down/left/right.\nYou cannot step on #.\n\n","art":"S . . .\n# # . #\n. . . #\n. # . T","options":["6 steps","7 steps","8 steps","9 steps"],"answerIndex":1}');
INSERT INTO event_questions VALUES(7,1,'P6-02',6,'{"id":"P6-02","level":"P6","topic":"Loops","qType":"Repeated action","details":"Simulates a loop and computes the final total.","title":"Stamping cards","points":4,"prompt":"A machine starts at 0 points.\nIt repeats 5 times:\nAdd 2 points.\n\nHow many points at the end?","options":["7","8","9","10"],"answerIndex":3}');
INSERT INTO event_questions VALUES(8,1,'P6-03',7,'{"id":"P6-03","level":"P6","topic":"Sorting","qType":"Minimum swaps (adjacent)","details":"Counts the minimum neighbouring swaps needed to sort (inversions).","title":"Neighbour swaps","points":4,"prompt":"You have: 2 4 1 3\nYou may swap only neighbouring numbers.\n\nMinimum swaps to sort into 1 2 3 4?","options":["2","3","4","5"],"answerIndex":1}');
INSERT INTO event_questions VALUES(9,1,'P6-04',8,'{"id":"P6-04","level":"P6","topic":"Conditions","qType":"Rule with priority","details":"Special-case rule overrides normal scoring.","title":"Bonus points","points":4,"prompt":"A quiz gives points like this:\n- Correct answer: +2\n- Extra bonus: If you answer correctly AND in under 10 seconds, you get +5 total (not +2).\n\nYou answer correctly in 8 seconds. How many points do you get?","options":["2","5","7","10"],"answerIndex":1}');
INSERT INTO event_questions VALUES(10,1,'P6-05',9,'{"id":"P6-05","level":"P6","topic":"Networks","qType":"Count shortest routes","details":"Counts distinct shortest routes in a small network.","title":"Two-step routes","points":4,"prompt":"A can connect to B and C.\nB can connect to D.\nC can connect to D.\n\nHow many different shortest routes are there from A to D?","options":["1","2","3","4"],"answerIndex":1}');
INSERT INTO event_questions VALUES(11,1,'S1-01',10,'{"id":"S1-01","level":"S1","topic":"Debugging","qType":"Edge case / equality","details":"Tests understanding of comparisons when values are equal.","title":"Pick the larger number","points":5,"prompt":"A student writes this rule to return the larger of A and B:\n\nIf A > B, return A\nElse return B\n\nWhat does this rule return when A = 3 and B = 3?","options":["3","B","It crashes","It returns nothing"],"answerIndex":1}');
INSERT INTO event_questions VALUES(12,1,'S1-02',11,'{"id":"S1-02","level":"S1","topic":"Binary","qType":"Bit counting","details":"Uses 2^n outcomes for n bits.","title":"How many codes?","points":5,"prompt":"A locker code uses exactly 4 bits (0/1).\n\nHow many different codes are possible?","options":["4","8","12","16"],"answerIndex":3}');
INSERT INTO event_questions VALUES(13,1,'S1-03',12,'{"id":"S1-03","level":"S1","topic":"Algorithms","qType":"Trace a procedure","details":"Traces a branching procedure across fixed iterations.","title":"Even-odd machine","points":5,"prompt":"Start with the number 10.\nRepeat exactly 3 times:\n- If the number is even, divide by 2\n- If the number is odd, add 3\n\nWhat is the final number?","options":["4","5","6","7"],"answerIndex":0}');
INSERT INTO event_questions VALUES(14,1,'S1-04',13,'{"id":"S1-04","level":"S1","topic":"Data representation","qType":"Encoding size","details":"Computes bits needed: pixels × bits per pixel.","title":"Pixel storage","points":5,"prompt":"A 5×5 black/white image uses 1 bit per pixel.\n\nHow many bits are needed in total?","options":["10","15","20","25"],"answerIndex":3}');
INSERT INTO event_questions VALUES(15,1,'S1-05',14,'{"id":"S1-05","level":"S1","topic":"Logic","qType":"OR condition","details":"Understands OR: either condition is enough.","title":"Club entry rule","points":5,"prompt":"A club rule says:\nYou may enter if you have a PASS OR you are with a TEACHER.\n\nYou have no pass, but you are with a teacher.\nCan you enter?","options":["Yes","No","Only on weekends","Not enough information"],"answerIndex":0}');
INSERT INTO event_questions VALUES(16,1,'S2-01',15,'{"id":"S2-01","level":"S2","topic":"Efficiency","qType":"Compare strategies","details":"Chooses strategy with fewer checks in the worst case (binary search idea).","title":"Finding a name","points":6,"prompt":"A list has 100 names.\nStrategy A: start from the top and check one by one.\nStrategy B: the list is sorted, so you can repeatedly check the middle and cut the list in half.\n\nIn the worst case, which strategy uses fewer checks?","options":["A","B","Same","Cannot compare"],"answerIndex":1}');
INSERT INTO event_questions VALUES(17,1,'S2-02',16,'{"id":"S2-02","level":"S2","topic":"Graphs / routing","qType":"Cheapest path (weighted)","details":"Finds minimum total cost, not minimum number of steps.","title":"Cheapest route","points":6,"prompt":"A delivery bot can travel these paths (cost in minutes):\nA→B (2), A→C (5), B→D (6), C→D (1), B→C (1)\n\nWhat is the cheapest cost from A to D?","options":["6","7","8","9"],"answerIndex":2}');
INSERT INTO event_questions VALUES(18,1,'S2-03',17,'{"id":"S2-03","level":"S2","topic":"Invariants","qType":"Parity / impossible state","details":"Flipping 2 tiles keeps number of black tiles even.","title":"Colour flips","points":6,"prompt":"You have 6 tiles in a row, all WHITE.\nOne move flips exactly 2 neighbouring tiles (WHITE↔BLACK).\n\nAfter any number of moves, which situation is impossible?","options":["0 black tiles","1 black tile","2 black tiles","4 black tiles"],"answerIndex":1}');
INSERT INTO event_questions VALUES(19,1,'S2-04',18,'{"id":"S2-04","level":"S2","topic":"Strings","qType":"Pattern matching (overlaps)","details":"Counts substring occurrences allowing overlaps.","title":"Counting blocks","points":6,"prompt":"A code is: ABABABAA\n\nHow many times does the block ''ABA'' appear if overlaps ARE allowed?","options":["1","2","3","4"],"answerIndex":2}');
INSERT INTO event_questions VALUES(20,1,'S2-05',19,'{"id":"S2-05","level":"S2","topic":"Cryptography basics","qType":"Caesar shift decode","details":"Decodes by shifting letters backward by 3.","title":"Shift message","points":6,"prompt":"A message uses this rule:\nA→D, B→E, C→F, ... (each letter shifts forward by 3)\n\nThe coded word is: KHOOR\nWhat is the original word?","options":["HELLO","KELLY","HOLLY","KHOOR"],"answerIndex":0}');
INSERT INTO event_questions VALUES(21,2,'P6-01',0,'{"id":"P6-01","level":"P6","topic":"Grids / paths","qType":"Shortest path","details":"Finds a shortest path length on a grid while avoiding obstacles.","title":"Shortest safe walk","points":4,"prompt":"You are at S and want to reach T.\nYou can move up/down/left/right.\nYou cannot step on #.\n\n","art":"S . . .\n# # . #\n. . . #\n. # . T","options":["6 steps","7 steps","8 steps","9 steps"],"answerIndex":1}');
INSERT INTO event_questions VALUES(22,2,'P6-02',1,'{"id":"P6-02","level":"P6","topic":"Loops","qType":"Repeated action","details":"Simulates a loop and computes the final total.","title":"Stamping cards","points":4,"prompt":"A machine starts at 0 points.\nIt repeats 5 times:\nAdd 2 points.\n\nHow many points at the end?","options":["7","8","9","10"],"answerIndex":3}');
INSERT INTO event_questions VALUES(23,2,'P6-03',2,'{"id":"P6-03","level":"P6","topic":"Sorting","qType":"Minimum swaps (adjacent)","details":"Counts the minimum neighbouring swaps needed to sort (inversions).","title":"Neighbour swaps","points":4,"prompt":"You have: 2 4 1 3\nYou may swap only neighbouring numbers.\n\nMinimum swaps to sort into 1 2 3 4?","options":["2","3","4","5"],"answerIndex":1}');
INSERT INTO event_questions VALUES(24,2,'P6-04',3,'{"id":"P6-04","level":"P6","topic":"Conditions","qType":"Rule with priority","details":"Special-case rule overrides normal scoring.","title":"Bonus points","points":4,"prompt":"A quiz gives points like this:\n- Correct answer: +2\n- Extra bonus: If you answer correctly AND in under 10 seconds, you get +5 total (not +2).\n\nYou answer correctly in 8 seconds. How many points do you get?","options":["2","5","7","10"],"answerIndex":1}');
INSERT INTO event_questions VALUES(25,2,'P6-05',4,'{"id":"P6-05","level":"P6","topic":"Networks","qType":"Count shortest routes","details":"Counts distinct shortest routes in a small network.","title":"Two-step routes","points":4,"prompt":"A can connect to B and C.\nB can connect to D.\nC can connect to D.\n\nHow many different shortest routes are there from A to D?","options":["1","2","3","4"],"answerIndex":1}');
CREATE TABLE attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id INTEGER NOT NULL,
      student_name TEXT NOT NULL,
      student_group TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'started',
      started_at TEXT NOT NULL,
      submitted_at TEXT,
      score INTEGER,
      max_score INTEGER,
      FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
    );
INSERT INTO attempts VALUES(1,1,'Ada','S1-2','submitted','2026-09-27T02:00:01.842Z','2026-09-27T02:00:01.851Z',16,90);
INSERT INTO attempts VALUES(2,1,'Grace','S2-1','started','2026-09-27T02:00:01.853Z',NULL,NULL,NULL);
INSERT INTO attempts VALUES(3,1,'Chen','S1-3','submitted','2026-09-27T02:00:01.855Z','2026-09-27T02:00:01.858Z',15,90);
INSERT INTO attempts VALUES(4,1,'Dev','S2-4','submitted','2026-09-27T02:00:01.861Z','2026-09-27T02:00:01.864Z',3,90);
CREATE TABLE answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attempt_id INTEGER NOT NULL,
      question_id TEXT NOT NULL,
      chosen_index INTEGER,
      correct_index INTEGER NOT NULL,
      earned_points INTEGER NOT NULL,
      max_points INTEGER NOT NULL,
      FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
    );
INSERT INTO answers VALUES(1,1,'P5-01',3,3,3,3);
INSERT INTO answers VALUES(2,1,'P5-02',1,1,3,3);
INSERT INTO answers VALUES(3,1,'P5-03',NULL,1,0,3);
INSERT INTO answers VALUES(4,1,'P5-04',NULL,1,0,3);
INSERT INTO answers VALUES(5,1,'P5-05',NULL,2,0,3);
INSERT INTO answers VALUES(6,1,'P6-01',1,1,4,4);
INSERT INTO answers VALUES(7,1,'P6-02',NULL,3,0,4);
INSERT INTO answers VALUES(8,1,'P6-03',NULL,1,0,4);
INSERT INTO answers VALUES(9,1,'P6-04',NULL,1,0,4);
INSERT INTO answers VALUES(10,1,'P6-05',NULL,1,0,4);
INSERT INTO answers VALUES(11,1,'S1-01',NULL,1,0,5);
INSERT INTO answers VALUES(12,1,'S1-02',NULL,3,0,5);
INSERT INTO answers VALUES(13,1,'S1-03',NULL,0,0,5);
INSERT INTO answers VALUES(14,1,'S1-04',NULL,3,0,5);
INSERT INTO answers VALUES(15,1,'S1-05',NULL,0,0,5);
INSERT INTO answers VALUES(16,1,'S2-01',NULL,1,0,6);
INSERT INTO answers VALUES(17,1,'S2-02',2,2,6,6);
INSERT INTO answers VALUES(18,1,'S2-03',NULL,1,0,6);
INSERT INTO answers VALUES(19,1,'S2-04',NULL,2,0,6);
INSERT INTO answers VALUES(20,1,'S2-05',NULL,0,0,6);
INSERT INTO answers VALUES(21,3,'P5-01',1,3,0,3);
INSERT INTO answers VALUES(22,3,'P5-02',NULL,1,0,3);
INSERT INTO answers VALUES(23,3,'P5-03',NULL,1,0,3);
INSERT INTO answers VALUES(24,3,'P5-04',NULL,1,0,3);
INSERT INTO answers VALUES(25,3,'P5-05',NULL,2,0,3);
INSERT INTO answers VALUES(26,3,'P6-01',1,1,4,4);
INSERT INTO answers VALUES(27,3,'P6-02',NULL,3,0,4);
INSERT INTO answers VALUES(28,3,'P6-03',NULL,1,0,4);
INSERT INTO answers VALUES(29,3,'P6-04',NULL,1,0,4);
INSERT INTO answers VALUES(30,3,'P6-05',NULL,1,0,4);
INSERT INTO answers VALUES(31,3,'S1-01',1,1,5,5);
INSERT INTO answers VALUES(32,3,'S1-02',NULL,3,0,5);
INSERT INTO answers VALUES(33,3,'S1-03',NULL,0,0,5);
INSERT INTO answers VALUES(34,3,'S1-04',NULL,3,0,5);
INSERT INTO answers VALUES(35,3,'S1-05',NULL,0,0,5);
INSERT INTO answers VALUES(36,3,'S2-01',NULL,1,0,6);
INSERT INTO answers VALUES(37,3,'S2-02',2,2,6,6);
INSERT INTO answers VALUES(38,3,'S2-03',NULL,1,0,6);
INSERT INTO answers VALUES(39,3,'S2-04',NULL,2,0,6);
INSERT INTO answers VALUES(40,3,'S2-05',NULL,0,0,6);
INSERT INTO answers VALUES(41,4,'P5-01',3,3,3,3);
INSERT INTO answers VALUES(42,4,'P5-02',NULL,1,0,3);
INSERT INTO answers VALUES(43,4,'P5-03',NULL,1,0,3);
INSERT INTO answers VALUES(44,4,'P5-04',NULL,1,0,3);
INSERT INTO answers VALUES(45,4,'P5-05',NULL,2,0,3);
INSERT INTO answers VALUES(46,4,'P6-01',0,1,0,4);
INSERT INTO answers VALUES(47,4,'P6-02',NULL,3,0,4);
INSERT INTO answers VALUES(48,4,'P6-03',NULL,1,0,4);
INSERT INTO answers VALUES(49,4,'P6-04',NULL,1,0,4);
INSERT INTO answers VALUES(50,4,'P6-05',NULL,1,0,4);
INSERT INTO answers VALUES(51,4,'S1-01',0,1,0,5);
INSERT INTO answers VALUES(52,4,'S1-02',NULL,3,0,5);
INSERT INTO answers VALUES(53,4,'S1-03',NULL,0,0,5);
INSERT INTO answers VALUES(54,4,'S1-04',NULL,3,0,5);
INSERT INTO answers VALUES(55,4,'S1-05',NULL,0,0,5);
INSERT INTO answers VALUES(56,4,'S2-01',NULL,1,0,6);
INSERT INTO answers VALUES(57,4,'S2-02',0,2,0,6);
INSERT INTO answers VALUES(58,4,'S2-03',NULL,1,0,6);
INSERT INTO answers VALUES(59,4,'S2-04',NULL,2,0,6);
INSERT INTO answers VALUES(60,4,'S2-05',NULL,0,0,6);
INSERT INTO sqlite_sequence VALUES('users',1);
INSERT INTO sqlite_sequence VALUES('events',2);
INSERT INTO sqlite_sequence VALUES('event_questions',25);
INSERT INTO sqlite_sequence VALUES('attempts',4);
INSERT INTO sqlite_sequence VALUES('answers',60);
COMMIT;
