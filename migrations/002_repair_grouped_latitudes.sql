-- Five-decimal Ayna values were parsed as 4.049233 and 4.049409.
-- Their two degree digits place both stops on the recorded bus 189 flow.
-- Exact old-value guards leave later upstream corrections untouched.
BEGIN;
UPDATE stops SET latitude = 40.49233 WHERE id = 3838 AND latitude = 4.049233;
UPDATE stops SET latitude = 40.49409 WHERE id = 3839 AND latitude = 4.049409;
UPDATE stop_details SET latitude = 40.49233 WHERE id = 3838 AND latitude = 4.049233;
UPDATE stop_details SET latitude = 40.49409 WHERE id = 3839 AND latitude = 4.049409;
COMMIT;
