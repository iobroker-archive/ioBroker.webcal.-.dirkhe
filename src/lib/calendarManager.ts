import type { AdapterInstance } from '@iobroker/adapter-core';
// @typescript-eslint/consistent-type-imports
import dayjs, { type Dayjs } from 'dayjs';
import dayjs_timezone from 'dayjs/plugin/timezone';
import dayjs_utc from 'dayjs/plugin/utc';
import type { Event } from './eventManager';

dayjs.extend(dayjs_timezone);
dayjs.extend(dayjs_utc);
export const localTimeZone = dayjs.tz.guess();
dayjs.tz.setDefault(localTimeZone);

let adapter: AdapterInstance;
let i18n: Record<string, string> = {};

export interface ICalendarTimeRangObj {
    startDate: Date;
    endDate: Date;
}

export class jsonEvent {
    id: string | null;
    date: Date;
    startTime?: string;
    endTime?: string;
    calendarName: string;
    summary?: string;

    constructor(event: CalendarEvent, date: Date, startTime?: string, endTime?: string) {
        this.id = event.id;
        this.calendarName = event.calendarName;
        this.summary = event.summary;
        this.date = date;
        this.startTime = startTime;
        this.endTime = endTime;
    }

    toString(): string {
        return this.isAllday()
            ? i18n.allDay
            : (this.startTime ? `${i18n.from} ${this.startTime}` : '') +
                  (this.endTime ? `${(this.startTime ? ' ' : '') + i18n.until} ${this.endTime}` : '');
    }
    isAllday(): boolean {
        return !this.startTime && !this.endTime;
    }
}
export abstract class CalendarEvent implements webcal.ICalendarEventBase {
    static daysFuture = 3;
    static daysPast = 0;
    static todayMidnight: Dayjs = dayjs().startOf('d');
    calendarName: string;
    id: string | null;
    maxUnixTime: number;
    summary?: string;
    description?: string;

    constructor(endDate: Date, calendarName: string, id: string | null) {
        this.id = id;
        this.calendarName = calendarName;
        this.maxUnixTime = dayjs(endDate).unix();
    }

    abstract getNextTimeObj(isFirstCall: boolean): ICalendarTimeRangObj | null;

    searchForEvents(events: Record<string, Event>): void {
        const content = (this.summary || '') + (this.description || '');
        if (content.length) {
            adapter.log.debug(
                `check calendar(${this.calendarName}) event '${this.summary || ''}' ${this.description || ''}`,
            );
            const eventHits = [];
            for (const evID in events) {
                const event = events[evID];
                if (event.checkCalendarContent(content, this.calendarName)) {
                    adapter.log.debug(`  found event '${event.name}' in calendar-event `);
                    eventHits.push(event);
                }
            }
            if (eventHits.length > 0) {
                let timeObj = this.getNextTimeObj(true);
                while (timeObj) {
                    const evTimeObj = {
                        start: dayjs(timeObj.startDate),
                        end: dayjs(timeObj.endDate),
                    };
                    const days: Record<number, jsonEvent> = this.calcDays(evTimeObj);
                    for (let e = 0; e < eventHits.length; e++) {
                        eventHits[e].addCalendarEvent(days);
                    }
                    timeObj = this.getNextTimeObj(false);
                }
            }
        }
    }

    calcDays(timeObj: webcal.IEventTimeRangObj): Record<number, jsonEvent> {
        const days: Record<number, jsonEvent> = {};
        if (timeObj) {
            const firstDay = timeObj.start.startOf('D').diff(CalendarEvent.todayMidnight, 'd');
            let time = timeObj.start.format('HH:mm');
            if (!timeObj.start.isSame(timeObj.end)) {
                let lastDay = Math.min(
                    timeObj.end.startOf('D').diff(CalendarEvent.todayMidnight, 'd'),
                    CalendarEvent.daysFuture,
                );

                let d: number = firstDay;
                if (firstDay < -CalendarEvent.daysPast) {
                    // Event start bevor timerange
                    d = -CalendarEvent.daysPast;
                } else if (time != '00:00') {
                    // Event start in timerange
                    days[firstDay] = new jsonEvent(this, timeObj.start.toDate(), time);
                    d++;
                }
                time = timeObj.end.format('HH:mm');
                if (time == '00:00') {
                    // we have midnight as endTime, so let use day before with 23:59
                    lastDay--;
                    time = '23:59';
                }
                for (; d <= lastDay; d++) {
                    days[d] = new jsonEvent(this, timeObj.start.add(d - firstDay, 'd').toDate());
                }
                if (time != '23:59') {
                    if (days[lastDay]) {
                        days[lastDay].endTime = time;
                    }
                }
            } else if (firstDay >= -CalendarEvent.daysPast) {
                days[firstDay] = new jsonEvent(this, timeObj.start.toDate(), time != '00:00' ? time : undefined);
                time = timeObj.end.format('HH:mm');
                if (time != '23:59') {
                    //&& time != days[firstDay].startTime) {
                    days[firstDay].endTime = time;
                }
            }
            const days_string = JSON.stringify(days);
            if (days_string.length > 2) {
                adapter.log.debug(`days for calendar-event(${JSON.stringify(timeObj)}): ${days_string}`);
            } else {
                adapter.log.silly(`no days for calendar-event(${JSON.stringify(timeObj)}) found `);
            }
        }
        return days;
    }

    static parseDateTime(dateString: string): webcal.IEventDateTime {
        const dateTimeObj: webcal.IEventDateTime = {
            // first we use year, minute and day numbers as index
            year: 0,
            month: 1,
            day: 2,
            hour: 0,
            minute: 0,
            second: 0,
            isDate: false,
        };

        const terms = dateString.split(/[./T :-]/);
        if (terms.length > 2) {
            if (terms[0].length != 4) {
                dateTimeObj.year = 2;
                if (dateString[2] == '.' || dateString[1] == '.') {
                    dateTimeObj.day = 0;
                    dateTimeObj.month = 1;
                } else {
                    if (parseInt(terms[0], 10) > 12) {
                        dateTimeObj.day = 0;
                        dateTimeObj.month = 1;
                    } else {
                        dateTimeObj.month = 0;
                        dateTimeObj.day = 1;
                    }
                }
            } // else terms[0].length == 4 -> use default index
            dateTimeObj.year = parseInt(terms[dateTimeObj.year], 10);
            dateTimeObj.month = parseInt(terms[dateTimeObj.month], 10);
            dateTimeObj.day = parseInt(terms[dateTimeObj.day], 10);
            if (terms.length > 4) {
                dateTimeObj.hour = parseInt(terms[3], 10);
                dateTimeObj.minute = parseInt(terms[4], 10);
                if (dateTimeObj.hour < 12 && terms.length > 5) {
                    const hour12 = terms[5] + (terms.length > 6 ? terms[6] : '');
                    if (hour12.toLocaleLowerCase() == 'pm') {
                        dateTimeObj.hour += 12;
                    }
                }
            } else {
                dateTimeObj.isDate = true;
            }
            if (dateTimeObj.year < 100) {
                dateTimeObj.year += 2000;
            }
        }
        return dateTimeObj;
    }

    static getDateTimeISOStringFromEventDateTime(date: webcal.IEventDateTime): string {
        if (!date.isDate) {
            return new Date(date.year, date.month - 1, date.day, date.hour, date.minute, date.second).toISOString();
        }
        return new String(`20${date.year}`)
            .slice(-4)
            .concat('-', new String(`0${date.month}`).slice(-2), '-', new String(`0${date.day}`).slice(-2));
    }
}

export class CalendarManager {
    calendars: Record<string, webcal.ICalendarBase>;
    defaultCalendar: webcal.ICalendarBase | null = null;

    constructor(adapterInstance: AdapterInstance, i18nInstance: any) {
        adapter = adapterInstance;
        i18n = i18nInstance;
        this.calendars = {};
    }

    init(config: ioBroker.AdapterConfig): void {
        CalendarEvent.daysFuture = Math.max(config.daysEventFuture || 0, config.daysJSONFuture || 0);
        CalendarEvent.daysPast = Math.max(config.daysEventPast || 0, config.daysJSONPast || 0);
    }

    addCalendar(cal: webcal.ICalendarBase | null, name: string): void {
        if (cal) {
            this.calendars[name] = cal;
            if (!this.defaultCalendar) {
                this.defaultCalendar = cal;
            }
        }
    }

    /**
     * get data from all calendars
     *
     * @returns Array of CalendarEvents
     */
    async fetchCalendars(): Promise<CalendarEvent[]> {
        CalendarEvent.todayMidnight = dayjs().startOf('D');
        const calEvents: CalendarEvent[] = [];
        const startDate: Date = CalendarEvent.todayMidnight.add(-CalendarEvent.daysPast, 'd').toDate();
        const endDate: Date = CalendarEvent.todayMidnight.add(CalendarEvent.daysFuture, 'd').endOf('D').toDate();
        for (const c in this.calendars) {
            adapter.log.debug(`fetching Calendar ${c}`);
            const error = await this.calendars[c].loadEvents(calEvents, startDate, endDate);
            if (error) {
                adapter.log.error(`could not fetch Calendar ${c}: ${error}`);
            }
        }
        return calEvents;
    }

    /**
     * create new Event in calendar
     *
     * @param data as eventdata
     * @param calendarName optional name of calendar, otherwise default calender is used
     * @returns Response Object
     */
    async addEvent(
        data: webcal.ICalendarEventData,
        calendarName?: string,
    ): Promise<{ ok: boolean; message: string; errNo: number }> {
        const calendar = calendarName ? this.calendars[calendarName] : this.defaultCalendar;
        if (!calendar) {
            return { message: i18n.couldNotFoundCalendar + calendarName, errNo: 1, ok: false };
        }
        adapter.log.debug(`add Event to ${calendar.name}: ${JSON.stringify(data)}`);
        return calendar.addEvent(data);
    }
}
